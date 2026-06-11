import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { getSettings, loadThemeCss, listThemeSchemas, updateSettings } from "../services/notes";
import type {
  EditorFontSettings,
  TextDirection,
  EditorWidth,
  ThemeSchema,
} from "../types/note";

type ThemeMode = "light" | "dark";

const BUILT_IN_FONTS: Record<string, string> = {
  "system-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  monospace:
    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Courier New', monospace",
};

function resolveFontFamily(font: string, customFonts?: Record<string, string>): string {
  return BUILT_IN_FONTS[font] ?? customFonts?.[font] ?? font;
}

function getAvailableFonts(customFonts: Record<string, string>): { value: string; label: string }[] {
  const builtIn = [
    { value: "system-sans", label: "Sans" },
    { value: "serif", label: "Serif" },
    { value: "monospace", label: "Mono" },
  ];
  const customEntries = Object.entries(customFonts);
  if (customEntries.length === 0) return builtIn;
  return [
    ...builtIn,
    ...customEntries.map(([key]) => ({ value: key, label: key })),
  ];
}

const editorWidthMap: Record<Exclude<EditorWidth, "custom">, string> = {
  narrow: "36rem",
  normal: "48rem",
  wide: "64rem",
  full: "100%",
};

const DEFAULT_CUSTOM_WIDTH_PX = 768;

const defaultEditorFontSettings: Required<EditorFontSettings> = {
  baseFontFamily: "system-sans",
  baseFontSize: 15,
  boldWeight: 600,
  lineHeight: 1.6,
};

const DEFAULT_SCHEMA_BY_MODE: Record<ThemeMode, string> = {
  light: "Default",
  dark: "Default",
};

const USER_THEME_STYLE_ID = "aoroza-user-theme-css";

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
  colorSchema: string;
  setColorSchema: (schema: string) => void;
  themeSchemas: ThemeSchema[];
  availableColorSchemas: ThemeSchema[];
  reloadThemeCss: () => Promise<void>;
  editorFontSettings: Required<EditorFontSettings>;
  setEditorFontSetting: <K extends keyof EditorFontSettings>(
    key: K, value: EditorFontSettings[K]
  ) => void;
  resetEditorFontSettings: () => void;
  reloadSettings: () => Promise<void>;
  textDirection: TextDirection;
  setTextDirection: (dir: TextDirection) => void;
  editorWidth: EditorWidth;
  setEditorWidth: (width: EditorWidth) => void;
  interfaceZoom: number;
  setInterfaceZoom: (zoomOrUpdater: number | ((prev: number) => number)) => void;
  customEditorWidthPx: number;
  setCustomEditorWidthPx: (px: number) => void;
  setEditorMaxWidthLive: (value: string) => void;
  customFonts: Record<string, string>;
  getAvailableFonts: () => { value: string; label: string }[];
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

function applyFontCSSVariables(fonts: Required<EditorFontSettings>, customFonts: Record<string, string>) {
  const root = document.documentElement;
  root.style.setProperty("--editor-font-family", resolveFontFamily(fonts.baseFontFamily, customFonts));
  root.style.setProperty("--editor-base-font-size", `${fonts.baseFontSize}px`);
  root.style.setProperty("--editor-bold-weight", String(fonts.boldWeight));
  root.style.setProperty("--editor-line-height", String(fonts.lineHeight));
  root.style.setProperty("--editor-h1-size", `${fonts.baseFontSize * 2.25}px`);
  root.style.setProperty("--editor-h2-size", `${fonts.baseFontSize * 1.75}px`);
  root.style.setProperty("--editor-h3-size", `${fonts.baseFontSize * 1.5}px`);
  root.style.setProperty("--editor-h4-size", `${fonts.baseFontSize * 1.25}px`);
  root.style.setProperty("--editor-h5-size", `${fonts.baseFontSize}px`);
  root.style.setProperty("--editor-h6-size", `${fonts.baseFontSize}px`);
  root.style.setProperty("--editor-paragraph-spacing", "0.875em");
}

function applyLayoutCSSVariables(width: EditorWidth, customWidthPx?: number) {
  const root = document.documentElement;
  if (width === "custom" && customWidthPx) {
    root.style.setProperty("--editor-max-width", `${customWidthPx}px`);
  } else if (width !== "custom") {
    root.style.setProperty("--editor-max-width", editorWidthMap[width]);
  }
}

function isTextDirection(value: unknown): value is TextDirection {
  return value === "auto" || value === "ltr" || value === "rtl";
}

function getInitialTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function chooseColorSchemaForMode(
  mode: ThemeMode,
  requested: string | undefined,
  schemas: ThemeSchema[],
): string {
  const available = schemas.filter((schema) => schema.mode === mode);
  if (requested && available.some((schema) => schema.name === requested)) return requested;
  const defaultSchema = DEFAULT_SCHEMA_BY_MODE[mode];
  if (available.some((schema) => schema.name === defaultSchema)) return defaultSchema;
  return available[0]?.name ?? "Default";
}

function installThemeCss(css: string) {
  let style = document.getElementById(USER_THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = USER_THEME_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(() => getInitialTheme());
  const [colorSchema, setColorSchemaState] = useState<string>(() => DEFAULT_SCHEMA_BY_MODE[getInitialTheme()]);
  const [themeSchemas, setThemeSchemas] = useState<ThemeSchema[]>([]);
  const [editorFontSettings, setEditorFontSettings] = useState<Required<EditorFontSettings>>(defaultEditorFontSettings);
  const [textDirection, setTextDirectionState] = useState<TextDirection>("auto");
  const [editorWidth, setEditorWidthState] = useState<EditorWidth>("normal");
  const [interfaceZoom, setInterfaceZoomState] = useState(1.0);
  const [customEditorWidthPx, setCustomEditorWidthPxState] = useState(DEFAULT_CUSTOM_WIDTH_PX);
  const [customFonts, setCustomFontsState] = useState<Record<string, string>>({});
  const [isInitialized, setIsInitialized] = useState(false);

  const loadSettingsFromBackend = useCallback(async () => {
    try {
      const [settings, schemas, themeCss] = await Promise.all([
        getSettings(),
        listThemeSchemas(),
        loadThemeCss(),
      ]);
      installThemeCss(themeCss);
      setThemeSchemas(schemas);

      let loadedTheme = getInitialTheme();
      if (settings.theme) {
        const mode = settings.theme.mode as ThemeMode;
        if (mode === "light" || mode === "dark") loadedTheme = mode;
      }
      const loadedSchema = chooseColorSchemaForMode(
        loadedTheme,
        settings.theme?.colorSchema,
        schemas,
      );
      setThemeState(loadedTheme);
      setColorSchemaState(loadedSchema);
      if (settings.editorFont) {
        const fontSettings = Object.fromEntries(
          Object.entries(settings.editorFont).filter(([, v]) => v != null)
        ) as Partial<EditorFontSettings>;
        setEditorFontSettings({ ...defaultEditorFontSettings, ...fontSettings });
      }
      if (isTextDirection(settings.textDirection)) setTextDirectionState(settings.textDirection);
      if (settings.editorWidth === "narrow" || settings.editorWidth === "normal" ||
          settings.editorWidth === "wide" || settings.editorWidth === "full" || settings.editorWidth === "custom") {
        setEditorWidthState(settings.editorWidth);
      }
      if (typeof settings.interfaceZoom === "number" && settings.interfaceZoom >= 0.7 && settings.interfaceZoom <= 1.5) {
        setInterfaceZoomState(settings.interfaceZoom);
      }
      if (typeof settings.customEditorWidthPx === "number" && settings.customEditorWidthPx >= 480) {
        setCustomEditorWidthPxState(settings.customEditorWidthPx);
      }
      if (settings.customFonts) setCustomFontsState(settings.customFonts);
    } catch {
      // Use defaults on failure
    }
  }, []);

  const reloadSettings = useCallback(async () => {
    await loadSettingsFromBackend();
  }, [loadSettingsFromBackend]);

  useEffect(() => {
    loadSettingsFromBackend().finally(() => setIsInitialized(true));
  }, [loadSettingsFromBackend]);

  const resolvedTheme = theme;
  const availableColorSchemas = themeSchemas.filter((schema) => schema.mode === theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.colorSchema = colorSchema;
  }, [resolvedTheme, colorSchema]);

  const saveThemeSettings = useCallback(async (newMode: ThemeMode, newSchema: string) => {
    try {
      const settings = await getSettings();
      await updateSettings({ ...settings, theme: { mode: newMode, colorSchema: newSchema } });
    } catch (error) {
      console.error("Failed to save theme settings:", error);
    }
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    const nextSchema = chooseColorSchemaForMode(newTheme, colorSchema, themeSchemas);
    setThemeState(newTheme);
    setColorSchemaState(nextSchema);
    saveThemeSettings(newTheme, nextSchema);
  }, [colorSchema, saveThemeSettings, themeSchemas]);

  const setColorSchema = useCallback((newSchema: string) => {
    const nextSchema = chooseColorSchemaForMode(theme, newSchema, themeSchemas);
    setColorSchemaState(nextSchema);
    saveThemeSettings(theme, nextSchema);
  }, [saveThemeSettings, theme, themeSchemas]);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ["light", "dark"];
    const currentIndex = order.indexOf(theme);
    setTheme(order[(currentIndex + 1) % order.length]);
  }, [theme, setTheme]);

  const reloadThemeCss = useCallback(async () => {
    const [schemas, themeCss] = await Promise.all([listThemeSchemas(), loadThemeCss()]);
    installThemeCss(themeCss);
    setThemeSchemas(schemas);
    const nextSchema = chooseColorSchemaForMode(theme, colorSchema, schemas);
    setColorSchemaState(nextSchema);
    saveThemeSettings(theme, nextSchema);
  }, [colorSchema, saveThemeSettings, theme]);

  useEffect(() => { applyFontCSSVariables(editorFontSettings, customFonts); }, [editorFontSettings, customFonts]);
  useEffect(() => { applyLayoutCSSVariables(editorWidth, customEditorWidthPx); }, [editorWidth, customEditorWidthPx]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("zoom-no-transition");
    root.style.zoom = String(interfaceZoom);
    requestAnimationFrame(() => root.classList.remove("zoom-no-transition"));
  }, [interfaceZoom]);

  const fontSaveTimerRef = useRef<number | null>(null);

  const saveFontSettings = useCallback(async (newFontSettings: Required<EditorFontSettings>) => {
    if (fontSaveTimerRef.current) window.clearTimeout(fontSaveTimerRef.current);
    fontSaveTimerRef.current = window.setTimeout(async () => {
      try {
        const settings = await getSettings();
        await updateSettings({ ...settings, editorFont: newFontSettings });
      } catch (error) {
        console.error("Failed to save font settings:", error);
      }
    }, 500);
  }, []);

  const setEditorFontSetting = useCallback(<K extends keyof EditorFontSettings>(key: K, value: EditorFontSettings[K]) => {
    setEditorFontSettings((prev) => {
      const updated = { ...prev, [key]: value };
      saveFontSettings(updated);
      return updated;
    });
  }, [saveFontSettings]);

  const resetEditorFontSettings = useCallback(async () => {
    setEditorFontSettings(defaultEditorFontSettings);
    setTextDirectionState("auto");
    setEditorWidthState("normal");
    setInterfaceZoomState(1.0);
    setCustomEditorWidthPxState(DEFAULT_CUSTOM_WIDTH_PX);
    try {
      const settings = await getSettings();
      await updateSettings({
        ...settings, editorFont: defaultEditorFontSettings, textDirection: "auto",
        editorWidth: "normal", interfaceZoom: 1.0, customEditorWidthPx: undefined,
      });
    } catch (error) {
      console.error("Failed to reset editor settings:", error);
    }
  }, []);

  const setTextDirection = useCallback(async (dir: TextDirection) => {
    setTextDirectionState(dir);
    try { const s = await getSettings(); await updateSettings({ ...s, textDirection: dir }); }
    catch (e) { console.error("Failed to save text direction:", e); }
  }, []);

  const setEditorWidth = useCallback(async (width: EditorWidth) => {
    setEditorWidthState(width);
    try { const s = await getSettings(); await updateSettings({ ...s, editorWidth: width }); }
    catch (e) { console.error("Failed to save editor width:", e); }
  }, []);

  const setInterfaceZoom = useCallback((zoomOrUpdater: number | ((prev: number) => number)) => {
    setInterfaceZoomState((prev) => {
      const raw = typeof zoomOrUpdater === "function" ? zoomOrUpdater(prev) : zoomOrUpdater;
      return Math.round(Math.min(Math.max(raw, 0.7), 1.5) * 20) / 20;
    });
  }, []);

  const zoomSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isInitialized) return;
    if (zoomSaveTimerRef.current) window.clearTimeout(zoomSaveTimerRef.current);
    zoomSaveTimerRef.current = window.setTimeout(() => {
      getSettings().then((s) => updateSettings({ ...s, interfaceZoom })).catch(() => {});
    }, 500);
    return () => { if (zoomSaveTimerRef.current) window.clearTimeout(zoomSaveTimerRef.current); };
  }, [interfaceZoom, isInitialized]);

  const setCustomEditorWidthPx = useCallback(async (px: number) => {
    setEditorWidthState("custom");
    setCustomEditorWidthPxState(px);
    try { const s = await getSettings(); await updateSettings({ ...s, editorWidth: "custom", customEditorWidthPx: px }); }
    catch (e) { console.error("Failed to save custom width:", e); }
  }, []);

  const setEditorMaxWidthLive = useCallback((value: string) => {
    document.documentElement.style.setProperty("--editor-max-width", value);
  }, []);

  const getAvailableFontsCb = useCallback(() => {
    return getAvailableFonts(customFonts);
  }, [customFonts]);

  if (!isInitialized) {
    // Render with defaults immediately (avoids blank page in preview mode)
    return (
      <ThemeContext.Provider
        value={{
          theme, resolvedTheme, setTheme, cycleTheme,
          colorSchema, setColorSchema, themeSchemas, availableColorSchemas, reloadThemeCss,
          editorFontSettings, setEditorFontSetting, resetEditorFontSettings, reloadSettings,
          textDirection, setTextDirection, editorWidth, setEditorWidth,
          interfaceZoom, setInterfaceZoom, customEditorWidthPx, setCustomEditorWidthPx, setEditorMaxWidthLive,
          customFonts, getAvailableFonts: getAvailableFontsCb,
        }}
      >
        {children}
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider
      value={{
        theme, resolvedTheme, setTheme, cycleTheme,
        colorSchema, setColorSchema, themeSchemas, availableColorSchemas, reloadThemeCss,
        editorFontSettings, setEditorFontSetting, resetEditorFontSettings, reloadSettings,
        textDirection, setTextDirection, editorWidth, setEditorWidth,
        interfaceZoom, setInterfaceZoom, customEditorWidthPx, setCustomEditorWidthPx, setEditorMaxWidthLive,
        customFonts, getAvailableFonts: getAvailableFontsCb,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
