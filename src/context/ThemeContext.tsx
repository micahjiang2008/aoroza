import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getSettings, updateSettings } from "../services/notes";
import type {
  EditorFontSettings,
  TextDirection,
  EditorWidth,
  CustomColors,
  ThemeColorKey,
} from "../types/note";

type ThemeMode = "light" | "dark" | "system";

const BUILT_IN_FONTS: Record<string, string> = {
  "system-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  monospace:
    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Courier New', monospace",
};

function resolveFontFamily(font: string): string {
  return BUILT_IN_FONTS[font] ?? font;
}

function getAvailableFonts(customFonts: string[]): { value: string; label: string }[] {
  const builtIn = [
    { value: "system-sans", label: "Sans" },
    { value: "serif", label: "Serif" },
    { value: "monospace", label: "Mono" },
  ];
  if (customFonts.length === 0) return builtIn;
  return [
    ...builtIn,
    ...customFonts.map((f) => ({ value: f, label: f })),
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

const defaultThemeColors: Record<"light" | "dark", Record<ThemeColorKey, string>> = {
  light: {
    bg: "#ffffff",
    "bg-secondary": "#fafaf9",
    "bg-muted": "rgba(28, 25, 23, 0.06)",
    "bg-emphasis": "rgba(28, 25, 23, 0.09)",
    text: "#1c1917",
    "text-muted": "#78716c",
    border: "rgba(28, 25, 23, 0.08)",
    accent: "#1c1917",
    selection: "rgba(250, 204, 21, 0.4)",
  },
  dark: {
    bg: "rgb(22, 20, 19)",
    "bg-secondary": "rgb(14, 12, 11)",
    "bg-muted": "rgba(250, 249, 249, 0.05)",
    "bg-emphasis": "rgba(250, 249, 249, 0.08)",
    text: "#fafaf9",
    "text-muted": "#a8a29e",
    border: "rgba(250, 249, 249, 0.07)",
    accent: "#fafaf9",
    selection: "rgba(253, 224, 71, 0.35)",
  },
};

export { defaultThemeColors };

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
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
  customColorsLight: CustomColors;
  customColorsDark: CustomColors;
  setCustomColor: (mode: "light" | "dark", key: ThemeColorKey, value: string) => void;
  resetCustomColor: (mode: "light" | "dark", key: ThemeColorKey) => void;
  resetAllCustomColors: (mode: "light" | "dark") => void;
  customFonts: string[];
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

function applyFontCSSVariables(fonts: Required<EditorFontSettings>) {
  const root = document.documentElement;
  root.style.setProperty("--editor-font-family", resolveFontFamily(fonts.baseFontFamily));
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

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [editorFontSettings, setEditorFontSettings] = useState<Required<EditorFontSettings>>(defaultEditorFontSettings);
  const [textDirection, setTextDirectionState] = useState<TextDirection>("auto");
  const [editorWidth, setEditorWidthState] = useState<EditorWidth>("normal");
  const [interfaceZoom, setInterfaceZoomState] = useState(1.0);
  const [customEditorWidthPx, setCustomEditorWidthPxState] = useState(DEFAULT_CUSTOM_WIDTH_PX);
  const [customColorsLight, setCustomColorsLightState] = useState<CustomColors>({});
  const [customColorsDark, setCustomColorsDarkState] = useState<CustomColors>({});
  const [customFonts, setCustomFontsState] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  const loadSettingsFromBackend = useCallback(async () => {
    try {
      const settings = await getSettings();
      if (settings.theme) {
        const mode = settings.theme.mode as ThemeMode;
        if (mode === "light" || mode === "dark" || mode === "system") setThemeState(mode);
      }
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
      if (settings.customColorsLight) setCustomColorsLightState(settings.customColorsLight);
      if (settings.customColorsDark) setCustomColorsDarkState(settings.customColorsDark);
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

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  const saveThemeSettings = useCallback(async (newMode: ThemeMode) => {
    try {
      const settings = await getSettings();
      await updateSettings({ ...settings, theme: { mode: newMode } });
    } catch (error) {
      console.error("Failed to save theme settings:", error);
    }
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    saveThemeSettings(newTheme);
  }, [saveThemeSettings]);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ["light", "dark", "system"];
    const currentIndex = order.indexOf(theme);
    setTheme(order[(currentIndex + 1) % order.length]);
  }, [theme, setTheme]);

  useEffect(() => { applyFontCSSVariables(editorFontSettings); }, [editorFontSettings]);
  useEffect(() => { applyLayoutCSSVariables(editorWidth, customEditorWidthPx); }, [editorWidth, customEditorWidthPx]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("zoom-no-transition");
    root.style.zoom = String(interfaceZoom);
    requestAnimationFrame(() => root.classList.remove("zoom-no-transition"));
  }, [interfaceZoom]);

  const saveFontSettings = useCallback(async (newFontSettings: Required<EditorFontSettings>) => {
    try {
      const settings = await getSettings();
      await updateSettings({ ...settings, editorFont: newFontSettings });
    } catch (error) {
      console.error("Failed to save font settings:", error);
    }
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
    setCustomColorsLightState({});
    setCustomColorsDarkState({});
    try {
      const settings = await getSettings();
      await updateSettings({
        ...settings, editorFont: defaultEditorFontSettings, textDirection: "auto",
        editorWidth: "normal", interfaceZoom: 1.0, customEditorWidthPx: undefined,
        customColorsLight: undefined, customColorsDark: undefined,
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

  useEffect(() => {
    if (!isInitialized) return;
    getSettings().then((s) => updateSettings({ ...s, interfaceZoom })).catch(() => {});
  }, [interfaceZoom, isInitialized]);

  const setCustomEditorWidthPx = useCallback(async (px: number) => {
    setEditorWidthState("custom");
    setCustomEditorWidthPxState(px);
    try { const s = await getSettings(); await updateSettings({ ...s, editorWidth: "custom", customEditorWidthPx: px }); }
    catch (e) { console.error("Failed to save custom width:", e); }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const active = resolvedTheme === "dark" ? customColorsDark : customColorsLight;
    const defaults = defaultThemeColors[resolvedTheme];
    const keys: ThemeColorKey[] = ["bg","bg-secondary","bg-muted","bg-emphasis","text","text-muted","border","accent","selection"];
    for (const key of keys) {
      root.style.setProperty(`--color-${key}`, active[key] ?? defaults[key]);
    }
  }, [resolvedTheme, customColorsLight, customColorsDark]);

  const setCustomColor = useCallback(async (mode: "light" | "dark", key: ThemeColorKey, value: string) => {
    const setter = mode === "light" ? setCustomColorsLightState : setCustomColorsDarkState;
    const settingsKey = mode === "light" ? "customColorsLight" : "customColorsDark";
    setter((prev) => {
      const updated = { ...prev, [key]: value };
      getSettings().then((s) => updateSettings({ ...s, [settingsKey]: updated })).catch(() => {});
      return updated;
    });
  }, []);

  const resetCustomColor = useCallback(async (mode: "light" | "dark", key: ThemeColorKey) => {
    const setter = mode === "light" ? setCustomColorsLightState : setCustomColorsDarkState;
    const settingsKey = mode === "light" ? "customColorsLight" : "customColorsDark";
    setter((prev) => {
      const updated = { ...prev }; delete updated[key];
      getSettings().then((s) => updateSettings({ ...s, [settingsKey]: Object.keys(updated).length > 0 ? updated : undefined })).catch(() => {});
      return updated;
    });
  }, []);

  const resetAllCustomColors = useCallback(async (mode: "light" | "dark") => {
    const setter = mode === "light" ? setCustomColorsLightState : setCustomColorsDarkState;
    const settingsKey = mode === "light" ? "customColorsLight" : "customColorsDark";
    setter({});
    try { const s = await getSettings(); await updateSettings({ ...s, [settingsKey]: undefined }); }
    catch (e) { console.error("Failed to reset custom colors:", e); }
  }, []);

  const setEditorMaxWidthLive = useCallback((value: string) => {
    document.documentElement.style.setProperty("--editor-max-width", value);
  }, []);

  const getAvailableFontsCb = useCallback(() => {
    return getAvailableFonts(customFonts);
  }, [customFonts]);

  if (!isInitialized) return null;

  return (
    <ThemeContext.Provider
      value={{
        theme, resolvedTheme, setTheme, cycleTheme,
        editorFontSettings, setEditorFontSetting, resetEditorFontSettings, reloadSettings,
        textDirection, setTextDirection, editorWidth, setEditorWidth,
        interfaceZoom, setInterfaceZoom, customEditorWidthPx, setCustomEditorWidthPx, setEditorMaxWidthLive,
        customColorsLight, customColorsDark, setCustomColor, resetCustomColor, resetAllCustomColors,
        customFonts, getAvailableFonts: getAvailableFontsCb,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
