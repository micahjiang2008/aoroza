use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::{Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use walkdir::WalkDir;

// ── Data structures ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSettings {
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EditorFontSettings {
    pub base_font_family: Option<String>,
    pub base_font_size: Option<f32>,
    pub bold_weight: Option<i32>,
    pub line_height: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: Option<ThemeSettings>,
    pub editor_font: Option<EditorFontSettings>,
    pub pinned_note_ids: Option<Vec<String>>,
    pub folders_enabled: Option<bool>,
    pub ignored_patterns: Option<Vec<String>>,
    pub default_note_name: Option<String>,
    pub text_direction: Option<String>,
    pub editor_width: Option<String>,
    pub custom_editor_width_px: Option<i32>,
    pub interface_zoom: Option<f32>,
    pub custom_colors_light: Option<HashMap<String, String>>,
    pub custom_colors_dark: Option<HashMap<String, String>>,
    pub custom_fonts: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub notes_folder: Option<String>,
    pub settings: Option<Settings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub modified: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub path: String,
    pub modified: i64,
}

pub struct AppState {
    pub app_config: RwLock<AppConfig>,
    pub preview_file_paths: RwLock<HashMap<String, String>>,
    pub watcher: RwLock<Option<(notify::RecommendedWatcher, PathBuf)>>,
}
// ── Config paths ─────────────────────────────────────────────────────────

fn config_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot find home directory".to_string())?;
    let dir = PathBuf::from(home).join(".aoroza");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn config_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

fn load_config() -> AppConfig {
    let path = config_path().unwrap_or_default();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default()
    } else {
        AppConfig::default()
    }
}

fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Utility functions ────────────────────────────────────────────────────

const EXCLUDED_DIRS: &[&str] = &[".git", ".aoroza", ".obsidian", ".trash"];

const DEFAULT_IGNORED_DIRS: &[&str] = &[
    "node_modules", ".next", ".nuxt", "dist", "build", "out", "target",
    "vendor", "__pycache__", ".venv", "venv", ".cache",
];

fn get_effective_ignored_dirs(settings: &Settings) -> Vec<String> {
    settings.ignored_patterns.clone().unwrap_or_else(|| {
        DEFAULT_IGNORED_DIRS.iter().map(|s| s.to_string()).collect()
    })
}

fn is_visible_entry(entry: &walkdir::DirEntry, ignored_dirs: &[String]) -> bool {
    if entry.file_type().is_dir() {
        let name = entry.file_name().to_str().unwrap_or("");
        return !EXCLUDED_DIRS.contains(&name) && !ignored_dirs.iter().any(|d| d == name);
    }
    true
}

fn extract_title(content: &str) -> String {
    let body = strip_frontmatter(content);
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("# ") {
            let t = title.trim();
            if !t.is_empty() && !is_effectively_empty(t) {
                return t.to_string();
            }
        }
        if !is_effectively_empty(trimmed) {
            return trimmed.chars().take(50).collect();
        }
    }
    "Untitled".to_string()
}

fn strip_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start();
    if trimmed.starts_with("---") {
        if let Some(rest) = trimmed.strip_prefix("---") {
            if let Some(end) = rest.find("\n---") {
                let after = &rest[end + 4..];
                return after.strip_prefix("\r\n").or_else(|| after.strip_prefix('\n')).unwrap_or(after);
            }
        }
    }
    content
}

fn generate_preview(content: &str) -> String {
    let body = strip_frontmatter(content);
    for line in body.lines().skip(1) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            let stripped = strip_markdown(trimmed);
            if !stripped.is_empty() {
                return stripped.chars().take(100).collect();
            }
        }
    }
    String::new()
}

fn strip_markdown(text: &str) -> String {
    let mut result = text.to_string();
    let trimmed_h = result.trim_start();
    if trimmed_h.starts_with('#') {
        result = trimmed_h.trim_start_matches('#').trim_start().to_string();
    }
    while let Some(s) = result.find("~~") {
        if let Some(e) = result[s + 2..].find("~~") {
            let inner = &result[s + 2..s + 2 + e];
            result = format!("{}{}{}", &result[..s], inner, &result[s + 4 + e..]);
        } else { break; }
    }
    while let Some(s) = result.find("**") {
        if let Some(e) = result[s + 2..].find("**") {
            let inner = &result[s + 2..s + 2 + e];
            result = format!("{}{}{}", &result[..s], inner, &result[s + 4 + e..]);
        } else { break; }
    }
    while let Some(s) = result.find("__") {
        if let Some(e) = result[s + 2..].find("__") {
            let inner = &result[s + 2..s + 2 + e];
            result = format!("{}{}{}", &result[..s], inner, &result[s + 4 + e..]);
        } else { break; }
    }
    while let Some(s) = result.find('`') {
        if let Some(e) = result[s + 1..].find('`') {
            let inner = &result[s + 1..s + 1 + e];
            result = format!("{}{}{}", &result[..s], inner, &result[s + 2 + e..]);
        } else { break; }
    }
    let img_re = Regex::new(r"!\[([^\]]*)\]\([^)]+\)").unwrap();
    result = img_re.replace_all(&result, "$1").to_string();
    let link_re = Regex::new(r"\[([^\]]+)\]\([^)]+\)").unwrap();
    result = link_re.replace_all(&result, "$1").to_string();
    while let Some(s) = result.find('*') {
        if let Some(e) = result[s + 1..].find('*') {
            if e > 0 { let inner = &result[s + 1..s + 1 + e]; result = format!("{}{}{}", &result[..s], inner, &result[s + 2 + e..]); } else { break; }
        } else { break; }
    }
    while let Some(s) = result.find('_') {
        if let Some(e) = result[s + 1..].find('_') {
            if e > 0 { let inner = &result[s + 1..s + 1 + e]; result = format!("{}{}{}", &result[..s], inner, &result[s + 2 + e..]); } else { break; }
        } else { break; }
    }
    result = result.replace("- [ ] ", "").replace("- [x] ", "");
    result.trim().to_string()
}

fn is_effectively_empty(s: &str) -> bool {
    s.chars().all(|c| c.is_whitespace() || c == '\u{00A0}' || c == '\u{FEFF}')
}

fn update_heading(content: &str, new_title: &str) -> String {
    // Replace the first H1 heading with the new title
    if let Some(pos) = content.find("# ") {
        let after_hash = &content[pos + 2..];
        let line_end = after_hash.find('\n').unwrap_or(after_hash.len());
        let mut result = String::with_capacity(content.len() + new_title.len());
        result.push_str(&content[..pos + 2]);
        result.push_str(new_title);
        result.push_str(&after_hash[line_end..]);
        return result;
    }
    // No H1 found, prepend one
    format!("# {}\n\n{}", new_title, content)
}

fn sanitize_filename(title: &str) -> String {
    let s: String = title.chars().filter(|c| *c != '\u{00A0}' && *c != '\u{FEFF}')
        .map(|c| match c { '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-', _ => c })
        .collect();
    let trimmed = s.trim();
    if trimmed.is_empty() || is_effectively_empty(trimmed) { "Untitled".to_string() } else { trimmed.to_string() }
}

fn ordinal_suffix(day: u32) -> &'static str {
    match (day % 100, day % 10) {
        (11..=13, _) => "th",
        (_, 1) => "st",
        (_, 2) => "nd",
        (_, 3) => "rd",
        _ => "th",
    }
}

fn expand_note_name_template(template: &str) -> String {
    use chrono::{Datelike, Local};
    let mut result = template.to_string();
    let now = Local::now();
    result = result.replace("{timestamp}", &now.timestamp().to_string());
    result = result.replace("{date}", &now.format("%Y-%m-%d").to_string());
    result = result.replace("{year}", &now.format("%Y").to_string());
    result = result.replace("{month}", &now.format("%m").to_string());
    result = result.replace("{day}", &now.format("%d").to_string());
    result = result.replace("{monthName}", &now.format("%B").to_string());
    result = result.replace("{monthShort}", &now.format("%b").to_string());
    result = result.replace("{weekday}", &now.format("%A").to_string());
    result = result.replace("{weekdayShort}", &now.format("%a").to_string());
    let day_num = now.day();
    result = result.replace("{dayOrdinal}", &format!("{}{}", day_num, ordinal_suffix(day_num)));
    result = result.replace("{time}", &now.format("%H-%M-%S").to_string());
    result
}

fn id_from_path(root: &Path, file_path: &Path, ignored: &[String]) -> Option<String> {
    let rel = file_path.strip_prefix(root).ok()?;
    for comp in rel.parent().unwrap_or(Path::new("")).components() {
        if let std::path::Component::Normal(name) = comp {
            let s = name.to_str()?;
            if EXCLUDED_DIRS.contains(&s) || ignored.iter().any(|d| d == s) { return None; }
        }
    }
    if file_path.extension()?.to_str()? != "md" { return None; }
    let rel_str = rel.to_str()?;
    let id = rel_str.strip_suffix(".md")?.replace(std::path::MAIN_SEPARATOR, "/");
    if id.is_empty() { None } else { Some(id) }
}

fn abs_path_from_id(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.contains('\\') { return Err("Invalid note ID".to_string()); }
    let rel = Path::new(id);
    for comp in rel.components() {
        match comp {
            std::path::Component::ParentDir => return Err("Path traversal".to_string()),
            std::path::Component::CurDir => return Err("Invalid path".to_string()),
            std::path::Component::RootDir | std::path::Component::Prefix(_) => return Err("Absolute path".to_string()),
            _ => {}
        }
    }
    let mut path = root.join(rel).into_os_string();
    path.push(".md");
    let path = PathBuf::from(path);
    if !path.starts_with(root) { return Err("Path escapes root".to_string()); }
    Ok(path)
}

fn extract_title_from_id(id: &str) -> String {
    let filename = id.rsplit('/').next().unwrap_or(id);
    let title = filename.replace(['-', '_'], " ");
    title.split_whitespace().map(|word| {
        let mut chars = word.chars();
        match chars.next() { None => String::new(), Some(first) => first.to_uppercase().to_string() + chars.as_str() }
    }).collect::<Vec<_>>().join(" ")
}

fn get_notes_folder_path(state: &State<AppState>) -> Result<PathBuf, String> {
    let folder = state.app_config.read().map_err(|e| e.to_string())?
        .notes_folder.clone().ok_or("Notes folder not set".to_string())?;
    Ok(PathBuf::from(&folder))
}

// ── Preview mode data structures ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub title: String,
    pub modified: i64,
}

fn validate_preview_path(path: &str) -> Result<PathBuf, String> {
    let file_path = PathBuf::from(path);
    match file_path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") => {}
        _ => return Err("Only .md and .markdown files are allowed".to_string()),
    }
    let canonical = file_path.canonicalize().map_err(|e| format!("Cannot resolve file path: {}", e))?;
    Ok(canonical)
}

fn get_preview_window_label(file_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    file_path.hash(&mut hasher);
    format!("preview-{:x}", hasher.finish())
}

fn create_preview_window(app: &tauri::AppHandle, file_path: &str) -> Result<(), String> {
    let label = get_preview_window_label(file_path);
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let filename = PathBuf::from(file_path)
        .file_name().map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Preview".to_string());
    // Use index.html to avoid 404/blank page when resolving route in production
    let builder = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title(format!("{} \u{2014} Aoroza", filename))
        .inner_size(800.0, 600.0)
        .min_inner_size(400.0, 300.0)
        .resizable(true)
        .decorations(true);
    let window = builder.build().map_err(|e| format!("Failed to create preview window: {}", e))?;
    // Open devtools automatically for debugging only
    #[cfg(debug_assertions)]
    let _ = window.open_devtools();
    let win = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = win.set_focus();
    });
    Ok(())
}

// ── Tauri Commands ───────────────────────────────────────────────────────

#[tauri::command]
fn get_notes_folder(state: State<AppState>) -> Option<String> {
    state.app_config.read().ok()?.notes_folder.clone()
}

#[tauri::command]
fn set_notes_folder(path: String, state: State<AppState>) -> Result<(), String> {
    { let mut c = state.app_config.write().map_err(|e| e.to_string())?; c.notes_folder = Some(path); }
    let c = state.app_config.read().map_err(|e| e.to_string())?;
    save_config(&*c)
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.app_config.read().ok().and_then(|c| c.settings.clone()).unwrap_or_default()
}

#[tauri::command]
fn update_settings(new_settings: Settings, state: State<AppState>) -> Result<(), String> {
    { let mut c = state.app_config.write().map_err(|e| e.to_string())?; c.settings = Some(new_settings); }
    let c = state.app_config.read().map_err(|e| e.to_string())?;
    save_config(&*c)
}

#[tauri::command]
fn list_notes(state: State<AppState>) -> Result<Vec<NoteMetadata>, String> {
    let path = get_notes_folder_path(&state)?;
    if !path.exists() { return Ok(vec![]); }
    let settings = state.app_config.read().map_err(|e| e.to_string())?.settings.clone().unwrap_or_default();
    let ignored = get_effective_ignored_dirs(&settings);

    let mut notes = Vec::new();
    for entry in WalkDir::new(&path).max_depth(10).into_iter().filter_entry(|e| is_visible_entry(e, &ignored)).flatten() {
        let fp = entry.path();
        if !fp.is_file() { continue; }
        if let Some(id) = id_from_path(&path, fp, &ignored) {
            if let Ok(content) = std::fs::read_to_string(fp) {
                let modified = entry.metadata().ok().and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
                notes.push(NoteMetadata { id, title: extract_title(&content), preview: generate_preview(&content), modified });
            }
        }
    }
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

#[tauri::command]
fn read_note(id: String, state: State<AppState>) -> Result<Note, String> {
    let folder = get_notes_folder_path(&state)?;
    let file_path = abs_path_from_id(&folder, &id)?;
    if !file_path.exists() { return Err("Note not found".to_string()); }
    let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let modified = std::fs::metadata(&file_path).ok().and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
    Ok(Note { id, title: extract_title(&content), content, path: file_path.to_string_lossy().into_owned(), modified })
}

#[tauri::command]
fn save_note(id: Option<String>, content: String, state: State<AppState>) -> Result<Note, String> {
    let folder = get_notes_folder_path(&state)?;
    let title = extract_title(&content);

    let (final_id, file_path) = if let Some(existing_id) = id {
        // Auto-save: always preserve original filename, never rename
        let fp = abs_path_from_id(&folder, &existing_id)?;
        (existing_id, fp)
    } else {
        // New note: compute filename from title
        let leaf = sanitize_filename(&title);
        let mut new_id = leaf.clone();
        let mut c = 1;
        while abs_path_from_id(&folder, &new_id).map(|p| p.exists()).unwrap_or(false) {
            new_id = format!("{}-{}", leaf, c);
            c += 1;
        }
        let fp = abs_path_from_id(&folder, &new_id)?;
        (new_id, fp)
    };

    // Ensure parent dir exists (handles both new files and restored files after deletion)
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file_path, &content).map_err(|e| e.to_string())?;

    let modified = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    Ok(Note { id: final_id, title, content, path: file_path.to_string_lossy().into_owned(), modified })
}

#[tauri::command]
fn create_note(target_folder: Option<String>, state: State<AppState>) -> Result<Note, String> {
    let folder = get_notes_folder_path(&state)?;
    let base = if let Some(ref f) = target_folder { if f.is_empty() { "Untitled".to_string() } else { format!("{}/Untitled", f.trim_end_matches('/')) } } else { "Untitled".to_string() };
    let mut final_id = base.clone(); let mut c = 1;
    while abs_path_from_id(&folder, &final_id).map(|p| p.exists()).unwrap_or(false) { c += 1; final_id = format!("{}-{}", base, c); }
    let display_title = extract_title_from_id(&final_id);
    let content = format!("# {}\n\n", display_title);
    let file_path = abs_path_from_id(&folder, &final_id)?;
    if let Some(parent) = file_path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::write(&file_path, &content).map_err(|e| e.to_string())?;
    let modified = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    Ok(Note { id: final_id, title: display_title, content, path: file_path.to_string_lossy().into_owned(), modified })
}

#[tauri::command]
fn delete_note(id: String, state: State<AppState>) -> Result<(), String> {
    let folder = get_notes_folder_path(&state)?;
    let file_path = abs_path_from_id(&folder, &id)?;
    if file_path.exists() { std::fs::remove_file(&file_path).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
fn list_folders(state: State<AppState>) -> Result<Vec<String>, String> {
    let folder = get_notes_folder_path(&state)?;
    let settings = state.app_config.read().map_err(|e| e.to_string())?.settings.clone().unwrap_or_default();
    let ignored = get_effective_ignored_dirs(&settings);
    let mut dirs = Vec::new();
    for entry in WalkDir::new(&folder).max_depth(10).into_iter().filter_entry(|e| is_visible_entry(e, &ignored)).flatten() {
        if entry.file_type().is_dir() && entry.path() != folder {
            if let Ok(rel) = entry.path().strip_prefix(&folder) {
                let s = rel.to_string_lossy().replace('\\', "/");
                if !s.is_empty() { dirs.push(s); }
            }
        }
    }
    dirs.sort();
    Ok(dirs)
}

#[tauri::command]
fn create_folder(path: String, state: State<AppState>) -> Result<(), String> {
    let folder = get_notes_folder_path(&state)?;
    let target = folder.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !target.starts_with(&folder) { return Err("Invalid path".to_string()); }
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_folder(path: String, state: State<AppState>) -> Result<(), String> {
    let folder = get_notes_folder_path(&state)?;
    let target = folder.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !target.starts_with(&folder) { return Err("Invalid path".to_string()); }
    if !target.is_dir() { return Err("Not a directory".to_string()); }
    std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_folder(old_path: String, new_name: String, state: State<AppState>) -> Result<(), String> {
    let folder = get_notes_folder_path(&state)?;
    let sanitized = new_name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-").trim().to_string();
    if sanitized.is_empty() { return Err("Name cannot be empty".to_string()); }
    let old = folder.join(old_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !old.starts_with(&folder) || !old.is_dir() { return Err("Invalid path".to_string()); }
    let new = old.parent().ok_or("No parent")?.join(&sanitized);
    if new.exists() { return Err("Folder already exists".to_string()); }
    std::fs::rename(&old, &new).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_note(old_id: String, new_name: String, state: State<AppState>) -> Result<String, String> {
    let folder = get_notes_folder_path(&state)?;
    let sanitized: String = new_name.chars()
        .filter(|c| *c != '\u{00A0}' && *c != '\u{FEFF}')
        .map(|c| match c { '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-', _ => c })
        .collect();
    let trimmed = sanitized.trim().to_string();
    if trimmed.is_empty() { return Err("Name cannot be empty".to_string()); }

    let source = abs_path_from_id(&folder, &old_id)?;
    if !source.exists() { return Err("Note not found".to_string()); }

    // Preserve folder path, replace leaf with new name
    let leaf = old_id.rsplit('/').next().unwrap_or(&old_id);
    let parent = old_id.trim_end_matches(leaf).trim_end_matches('/');
    let new_id = if parent.is_empty() { trimmed.clone() } else { format!("{}/{}", parent, trimmed) };

    // Check for conflicts and add suffix if needed
    let mut final_id = new_id.clone();
    let mut c = 1;
    while abs_path_from_id(&folder, &final_id).map(|p| p.exists()).unwrap_or(false) {
        final_id = if parent.is_empty() { format!("{}-{}", trimmed, c) } else { format!("{}/{}-{}", parent, trimmed, c) };
        c += 1;
    }

    let dest = abs_path_from_id(&folder, &final_id)?;
    if let Some(parent_dir) = dest.parent() { std::fs::create_dir_all(parent_dir).map_err(|e| e.to_string())?; }
    std::fs::rename(&source, &dest).map_err(|e| e.to_string())?;

    // Update H1 heading in content to match new name
    if let Ok(content) = std::fs::read_to_string(&dest) {
        let updated = update_heading(&content, &trimmed);
        let _ = std::fs::write(&dest, &updated);
    }

    Ok(final_id)
}

#[tauri::command]
fn move_note(id: String, target_folder: String, state: State<AppState>) -> Result<String, String> {
    let folder = get_notes_folder_path(&state)?;
    let source_path = abs_path_from_id(&folder, &id)?;
    if !source_path.exists() { return Err("Note not found".to_string()); }
    let leaf = id.rsplit('/').next().unwrap_or(&id);
    let new_id = if target_folder.is_empty() { leaf.to_string() } else { format!("{}/{}", target_folder, leaf) };
    let dest = abs_path_from_id(&folder, &new_id)?;
    if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    if dest.exists() { return Err("A note with that name already exists".to_string()); }
    std::fs::rename(&source_path, &dest).map_err(|e| e.to_string())?;
    Ok(new_id)
}

#[tauri::command]
fn move_folder(path: String, target_parent: String, state: State<AppState>) -> Result<(), String> {
    let folder = get_notes_folder_path(&state)?;
    let source = folder.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !source.is_dir() { return Err("Source is not a directory".to_string()); }
    let name = source.file_name().ok_or("No name")?.to_string_lossy().to_string();
    let dest = if target_parent.is_empty() { folder.join(&name) } else { folder.join(target_parent.replace('/', std::path::MAIN_SEPARATOR_STR)).join(&name) };
    if dest.starts_with(&source) { return Err("Cannot move into itself".to_string()); }
    if dest.exists() { return Err("Folder already exists".to_string()); }
    if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::rename(&source, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn preview_note_name(template: String) -> Result<String, String> {
    let expanded = expand_note_name_template(&template);
    let preview = if template.contains("{counter}") {
        expanded.replace("{counter}", "1")
    } else {
        expanded
    };
    Ok(preview)
}

#[tauri::command]
fn get_default_ignored_patterns() -> Vec<String> {
    DEFAULT_IGNORED_DIRS.iter().map(|s| s.to_string()).collect()
}

#[tauri::command]
fn copy_to_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text.clone()).map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
async fn open_folder_dialog(
    app: tauri::AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file().set_can_create_directories(true);
        if let Some(path) = default_path {
            builder = builder.set_directory(path);
        }
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("Dialog task failed: {}", e))?;
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
async fn open_in_file_manager(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() || !path_buf.is_dir() {
        return Err("Path does not exist or is not a directory".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        let windows_path = path.replace("/", "\\");
        std::process::Command::new("explorer")
            .arg(&windows_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        return Err("Unsupported platform".to_string());
    }
    Ok(())
}

// ── Preview mode commands ───────────────────────────────────────────────

#[tauri::command]
fn read_file_direct(path: String) -> Result<FileContent, String> {
    let canonical = validate_preview_path(&path)?;
    if !canonical.is_file() { return Err(format!("Not a file: {}", path)); }
    let content = std::fs::read_to_string(&canonical).map_err(|_| "Failed to read file".to_string())?;
    let metadata = std::fs::metadata(&canonical).map_err(|_| "Failed to read metadata".to_string())?;
    let modified = metadata.modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64).unwrap_or(0);
    let title = extract_title(&content);
    Ok(FileContent { path, content, title, modified })
}

#[tauri::command]
fn save_file_direct(path: String, content: String) -> Result<FileContent, String> {
    let canonical = validate_preview_path(&path)?;
    if !canonical.is_file() { return Err(format!("Not a file: {}", path)); }
    std::fs::write(&canonical, &content).map_err(|_| "Failed to write file".to_string())?;
    let metadata = std::fs::metadata(&canonical).map_err(|_| "Failed to read metadata".to_string())?;
    let modified = metadata.modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64).unwrap_or(0);
    let title = extract_title(&content);
    Ok(FileContent { path, content, title, modified })
}

#[tauri::command]
fn import_file_to_folder(
    app: tauri::AppHandle,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<NoteMetadata, String> {
    let source = validate_preview_path(&path)?;
    if !source.is_file() { return Err(format!("Not a file: {}", path)); }
    let folder = {
        let app_config = state.app_config.read().map_err(|e| e.to_string())?;
        app_config.notes_folder.clone().ok_or("Notes folder not set".to_string())?
    };
    let folder_path = PathBuf::from(&folder);
    let content = std::fs::read_to_string(&source).map_err(|_| "Failed to read source file".to_string())?;
    let extracted_title = extract_title(&content);
    let base_name = if extracted_title.trim().is_empty() {
        source.file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled").to_string()
    } else {
        sanitize_filename(&extracted_title)
    };
    let mut final_id = base_name.clone();
    let mut counter = 1;
    while abs_path_from_id(&folder_path, &final_id).map(|p| p.exists()).unwrap_or(false) {
        final_id = format!("{}-{}", base_name, counter);
        counter += 1;
    }
    let dest = abs_path_from_id(&folder_path, &final_id)?;
    if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::copy(&source, &dest).map_err(|_| "Failed to copy file".to_string())?;
    let modified = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64).unwrap_or(0);
    let title = extract_title(&content);
    let preview = generate_preview(&content);
    let note = NoteMetadata { id: final_id, title, preview, modified };
    let note_id = note.id.clone();
    let _ = app.emit("select-note", &note_id);
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
    Ok(note)
}

#[tauri::command]
fn open_file_preview(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() { return Err(format!("File not found: {}", path)); }
    // Store the preview file path mapped to the window label
    if let Some(state) = app.try_state::<AppState>() {
        let label = get_preview_window_label(&path);
        state.preview_file_paths.write().unwrap().insert(label, path.clone());
    }
    create_preview_window(&app, &path)?;
    Ok(())
}

#[tauri::command]
fn get_preview_file(window: tauri::Window, state: State<'_, AppState>) -> Option<String> {
    let label = window.label();
    state.preview_file_paths.read().unwrap().get(label).cloned()
}

#[tauri::command]
fn start_file_watcher(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    use notify::{Watcher, RecursiveMode};

    let folder = get_notes_folder_path(&state)?;
    
    // Check if we are already watching this folder
    {
        let watcher_guard = state.watcher.read().map_err(|e| e.to_string())?;
        if let Some((_, current_path)) = &*watcher_guard {
            if current_path == &folder {
                return Ok(()); // Already watching this path
            }
        }
    }

    // Stop and drop existing watcher
    {
        let mut watcher_guard = state.watcher.write().map_err(|e| e.to_string())?;
        *watcher_guard = None;
    }

    // Build the list of ignored directories to be captured by the closure
    let settings = state.app_config.read().ok().and_then(|c| c.settings.clone()).unwrap_or_default();
    let ignored_dirs = get_effective_ignored_dirs(&settings);
    let folder_clone = folder.clone();
    let app_clone = app.clone();

    // Create watcher
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            // Check if any of the affected paths are Markdown files or directories, and not in ignored paths
            let has_valid_changes = event.paths.iter().any(|p| {
                if let Ok(rel) = p.strip_prefix(&folder_clone) {
                    for comp in rel.components() {
                        if let std::path::Component::Normal(name) = comp {
                            if let Some(s) = name.to_str() {
                                if EXCLUDED_DIRS.contains(&s) || ignored_dirs.iter().any(|d| d == s) {
                                    return false;
                                }
                            }
                        }
                    }
                    // Filter: if path has an extension, it must be "md"
                    let has_extension = p.extension().is_some();
                    if has_extension && p.extension().and_then(|e| e.to_str()) != Some("md") {
                        return false;
                    }
                    true
                } else {
                    false
                }
            });

            if has_valid_changes {
                // Emit event to all webviews
                let _ = app_clone.emit("file-changed", ());
            }
        }
    }).map_err(|e| e.to_string())?;

    // Start watching
    watcher.watch(&folder, RecursiveMode::Recursive).map_err(|e| e.to_string())?;

    // Store the watcher
    {
        let mut watcher_guard = state.watcher.write().map_err(|e| e.to_string())?;
        *watcher_guard = Some((watcher, folder));
    }

    Ok(())
}

#[tauri::command]
fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(Path::new(&path), contents).map_err(|e| e.to_string())
}

// ── Application entrypoint ───────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.len() > 1 {
                let file_path = &args[1];
                if file_path.ends_with(".md") || file_path.ends_with(".markdown") {
                    let path = PathBuf::from(file_path);
                    if path.exists() && path.is_file() {
                        let path_str = path.to_string_lossy().into_owned();
                        let label = get_preview_window_label(&path_str);
                        if let Some(state) = app.try_state::<AppState>() {
                            state.preview_file_paths.write().unwrap().insert(label, path_str.clone());
                        }
                        let _ = create_preview_window(app, &path_str);
                        return;
                    }
                }
            }
            let _ = app.get_webview_window("main").map(|w| w.set_focus());
        }))
        .setup(|app| {
            app.manage(AppState {
                app_config: RwLock::new(load_config()),
                preview_file_paths: RwLock::new(HashMap::new()),
                watcher: RwLock::new(None),
            });

            // Handle CLI arguments on startup
            let args: Vec<String> = std::env::args().collect();
            let mut has_file_arg = false;
            if args.len() > 1 {
                let file_path = &args[1];
                if file_path.ends_with(".md") || file_path.ends_with(".markdown") {
                    let path = PathBuf::from(file_path);
                    if path.exists() && path.is_file() {
                        let path_str = path.to_string_lossy().into_owned();
                        let label = get_preview_window_label(&path_str);
                        if let Some(state) = app.try_state::<AppState>() {
                            state.preview_file_paths.write().unwrap().insert(label, path_str.clone());
                        }
                        let _ = create_preview_window(app.handle(), &path_str);
                        has_file_arg = true;
                    }
                }
            }

            if !has_file_arg {
                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.show();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_notes_folder, set_notes_folder,
            get_settings, update_settings,
            list_notes, read_note, save_note, create_note, delete_note,
            list_folders, create_folder, delete_folder, rename_folder, rename_note,
            move_note, move_folder,
            preview_note_name, get_default_ignored_patterns,
            open_folder_dialog, open_in_file_manager, copy_to_clipboard,
            read_file_direct, save_file_direct, import_file_to_folder,
            open_file_preview, get_preview_file, start_file_watcher,
            write_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
