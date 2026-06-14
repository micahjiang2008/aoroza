import { invoke } from "@tauri-apps/api/core";

// ── File operations ──────────────────────────────────────────────────────

export async function fileMtime(path: string): Promise<number | null> {
  return invoke("file_mtime", { path });
}

export async function newWindow(): Promise<void> {
  return invoke("new_window");
}

export async function openFileDialog(): Promise<string | null> {
  return invoke("open_file_dialog");
}

export async function readFile(path: string): Promise<string> {
  return invoke("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke("write_file", { path, contents: content });
}

export async function saveFileDialog(content: string, defaultName?: string): Promise<string | null> {
  return invoke("save_file_dialog", { content, defaultName: defaultName ?? null });
}

export interface EditorFontSettings {
  baseFontFamily?: string;
  baseFontSize?: number;
  boldWeight?: number;
  lineHeight?: number;
}

// ── Theme & settings ─────────────────────────────────────────────────────

export interface Settings {
  theme?: { mode: string; colorSchema?: string } | null;
  editorFont?: EditorFontSettings | null;
  textDirection?: string;
  editorWidth?: string;
  customEditorWidthPx?: number;
  interfaceZoom?: number;
  customFonts?: Record<string, string>;
  recentFiles?: string[];
}

export async function getSettings(): Promise<Settings> {
  return invoke("get_settings");
}

export async function updateSettings(settings: Settings): Promise<void> {
  return invoke("update_settings", { newSettings: settings });
}

export interface ThemeSchema {
  name: string;
  label: string;
  mode: string;
}

export async function listThemeSchemas(): Promise<ThemeSchema[]> {
  return invoke("list_theme_schemas");
}

export async function loadThemeCss(): Promise<string> {
  return invoke("load_theme_css");
}
