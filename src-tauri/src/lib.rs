use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

// ── Data structures ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSettings {
    pub mode: String,
    pub color_schema: Option<String>,
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
    pub text_direction: Option<String>,
    pub editor_width: Option<String>,
    pub custom_editor_width_px: Option<i32>,
    pub interface_zoom: Option<f32>,
    pub custom_fonts: Option<HashMap<String, String>>,
    pub window_maximized: Option<bool>,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    pub recent_files: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub settings: Option<Settings>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSchema {
    pub name: String,
    pub label: String,
    pub mode: String,
}

pub struct InlineSession {
    pub child: Option<Child>,
}

pub struct AppState {
    pub app_config: RwLock<AppConfig>,
    pub inline_session: Mutex<InlineSession>,
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

fn theme_css_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("theme.css"))
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

fn refresh_theme_css_file() -> Result<(Vec<ThemeSchema>, String), String> {
    let theme_path = theme_css_path()?;
    if !theme_path.exists() {
        std::fs::write(&theme_path, include_str!("../assets/default_theme.css"))
            .map_err(|e| e.to_string())?;
    }
    let css = std::fs::read_to_string(&theme_path).map_err(|e| e.to_string())?;

    let schema_re = Regex::new(
        r#":root\[data-theme="([^"]+)"\]\[data-color-schema="([^"]+)"\]"#,
    )
    .unwrap();
    let mut schemas: Vec<ThemeSchema> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for cap in schema_re.captures_iter(&css) {
        let mode = cap[1].to_string();
        let name = cap[2].to_string();
        if seen.insert((name.clone(), mode.clone())) {
            let label = if name == "default" {
                "Default".to_string()
            } else {
                name.replace('-', " ")
            };
            schemas.push(ThemeSchema { name, label, mode });
        }
    }
    if schemas.is_empty() {
        schemas = vec![
            ThemeSchema {
                name: "default".to_string(),
                label: "Default".to_string(),
                mode: "light".to_string(),
            },
            ThemeSchema {
                name: "default".to_string(),
                label: "Default".to_string(),
                mode: "dark".to_string(),
            },
        ];
    }

    Ok((schemas, css))
}

// ── Tauri Commands ───────────────────────────────────────────────────────

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state
        .app_config
        .read()
        .ok()
        .and_then(|c| c.settings.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn update_settings(new_settings: Settings, state: State<AppState>) -> Result<(), String> {
    {
        let mut c = state.app_config.write().map_err(|e| e.to_string())?;
        c.settings = Some(new_settings);
    }
    let c = state.app_config.read().map_err(|e| e.to_string())?;
    save_config(&*c)
}

#[tauri::command]
fn list_theme_schemas() -> Result<Vec<ThemeSchema>, String> {
    Ok(refresh_theme_css_file()?.0)
}

#[tauri::command]
fn load_theme_css() -> Result<String, String> {
    Ok(refresh_theme_css_file()?.1)
}

#[tauri::command]
fn copy_to_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text.clone())
        .map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
async fn open_file_dialog(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("Dialog task failed: {}", e))?;
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(Path::new(&path), contents).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_file_dialog(
    app: tauri::AppHandle,
    content: String,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app
            .dialog()
            .file()
            .add_filter("Markdown", &["md"]);
        if let Some(name) = default_name {
            builder = builder.set_file_name(name);
        }
        builder.blocking_save_file()
    })
    .await
    .map_err(|e| format!("Dialog task failed: {}", e))?;

    if let Some(path) = result {
        let path_str = path.to_string();
        write_file(path_str.clone(), content)?;
        Ok(Some(path_str))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn open_in_file_manager(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    #[cfg(target_os = "windows")]
    {
        let windows_path = path.replace("/", "\\");
        if path_buf.is_file() {
            std::process::Command::new("explorer")
                .arg("/select,")
                .arg(&windows_path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer")
                .arg(&windows_path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        if path_buf.is_file() {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "linux")]
    {
        let target = if path_buf.is_file() {
            path_buf
                .parent()
                .ok_or("Cannot get parent directory".to_string())?
                .to_string_lossy()
                .into_owned()
        } else {
            path
        };
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        return Err("Unsupported platform".to_string());
    }
    Ok(())
}

#[tauri::command]
fn file_mtime(path: String) -> Result<Option<i64>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(None);
    }
    std::fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| Some(d.as_secs() as i64))
        .ok_or("Failed to read mtime".to_string())
}

// ── Helpers ────────────────────────────────────────────────────────────

/// Create a Command that won't pop up a console window on Windows.
fn no_window_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

// ── Inline AI Generator ────────────────────────────────────────────────

/// Find pi's node.exe and cli.js; cached for the app lifetime.
fn find_pi_node_and_script() -> (String, String) {
    // Returns (node_exe, cli_js_path)
    let pi_cmd = {
        #[cfg(target_os = "windows")]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                let cmd = format!("{}\\npm\\pi.cmd", appdata);
                if Path::new(&cmd).exists() {
                    Some(cmd)
                } else {
                    None
                }
            } else {
                None
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    };

    // From pi.cmd, extract the npm prefix and locate cli.js
    if let Some(cmd_path) = pi_cmd {
        // pi.cmd is at: %APPDATA%\npm\pi.cmd
        // The npm prefix is the parent: %APPDATA%\npm
        if let Some(npm_dir) = Path::new(&cmd_path).parent() {
            let cli_js = npm_dir.join("node_modules").join("@earendil-works").join("pi-coding-agent").join("dist").join("cli.js");
            if cli_js.exists() {
                // Try npm's bundled node first
                let bundled_node = npm_dir.join("node.exe");
                let node_exe = if bundled_node.exists() {
                    bundled_node.to_string_lossy().to_string()
                } else {
                    "node".to_string()
                };
                return (node_exe, cli_js.to_string_lossy().to_string());
            }
        }
    }

    // Fallback: use 'pi' command directly
    ("pi".to_string(), String::new())
}

#[tauri::command]
async fn inline_generate(
    app: tauri::AppHandle,
    prompt: String,
    cwd: String,
) -> Result<String, String> {
    let (node_exe, cli_js) = find_pi_node_and_script();
    let _ = app.emit("inline:debug", serde_json::json!({
        "msg": format!("Using: {} {}", node_exe, cli_js),
    }));

    let stdin_input = format!("{}\n", serde_json::json!({
        "id": "inline-prompt",
        "type": "prompt",
        "message": prompt
    }));

    let mut cmd_builder = if !cli_js.is_empty() {
        let mut c = no_window_cmd(&node_exe);
        c.arg(&cli_js).arg("--mode").arg("json").arg("--no-session");
        c.current_dir(Path::new(&cwd));
        c
    } else {
        let mut c = no_window_cmd(&node_exe);
        c.args(["--mode", "json", "--no-session"]);
        c.current_dir(Path::new(&cwd));
        c
    };

    let timeout_duration = std::time::Duration::from_secs(120);
    let app_clone = app.clone();

    let task = tauri::async_runtime::spawn_blocking(move || {
        let process = cmd_builder
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start pi: {}", e))?;

        let _child_id = process.id();
        let child_arc = Arc::new(Mutex::new(process));

        // Write prompt to stdin, then close
        {
            let mut guard = child_arc.lock().map_err(|e| format!("Lock error: {}", e))?;
            if let Some(mut stdin) = guard.stdin.take() {
                if let Err(e) = stdin.write_all(stdin_input.as_bytes()) {
                    drop(guard);
                    if let Ok(mut g) = child_arc.lock() { let _ = g.kill(); let _ = g.wait(); }
                    return Err(format!("Failed to write to pi stdin: {}", e));
                }
            }
        }

        let stdout_handle = child_arc.lock().map_err(|e| format!("Lock error: {}", e))?.stdout.take();
        let stderr_handle = child_arc.lock().map_err(|e| format!("Lock error: {}", e))?.stderr.take();

        let mut stdout_str = String::new();
        if let Some(mut out) = stdout_handle { let _ = out.read_to_string(&mut stdout_str); }
        let mut stderr_str = String::new();
        if let Some(mut err) = stderr_handle { let _ = err.read_to_string(&mut stderr_str); }

        let success = child_arc.lock().ok().and_then(|mut g| g.wait().ok()).map(|s| s.success()).unwrap_or(false);

        if !stderr_str.is_empty() {
            let _ = app_clone.emit("inline:debug", serde_json::json!({
                "msg": format!("pi stderr: {}", stderr_str.trim()),
            }));
        }
        if !success {
            return Err(format!("pi exited with error: {}", stderr_str.trim()));
        }

        let mut generated = String::new();
        for raw_line in stdout_str.lines() {
            let line = raw_line.trim();
            if line.is_empty() { continue; }
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
                if event["type"].as_str() == Some("message_update") {
                    if let Some(ae) = event.get("assistantMessageEvent") {
                        if ae.get("type").and_then(|t| t.as_str()) == Some("text_delta") {
                            if let Some(delta) = ae.get("delta").and_then(|d| d.as_str()) {
                                generated.push_str(delta);
                            }
                        }
                    }
                }
            }
        }
        if generated.is_empty() { return Err("AI did not generate any content".to_string()); }
        let _ = app_clone.emit("inline:debug", serde_json::json!({"msg": format!("Generated {} chars", generated.len())}));
        Ok(generated)
    });

    match tokio::time::timeout(timeout_duration, task).await {
        Ok(join_result) => join_result.map_err(|e| format!("pi task error: {}", e))?,
        Err(_) => Err("pi timed out after 120 seconds".to_string()),
    }
}

#[tauri::command]
fn pi_check() -> Result<bool, String> {
    let (node_exe, cli_js) = find_pi_node_and_script();
    if cli_js.is_empty() {
        return Ok(false);
    }
    if !Path::new(&cli_js).exists() {
        return Ok(false);
    }
    let status = no_window_cmd(&node_exe)
        .arg("-e")
        .arg("process.exit(0)")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    Ok(status)
}

#[tauri::command]
fn pi_version() -> Result<String, String> {
    let (node_exe, cli_js) = find_pi_node_and_script();
    let script = if !cli_js.is_empty() {
        cli_js
    } else {
        return Err("Pi not found".to_string());
    };
    let output = no_window_cmd(&node_exe)
        .arg(&script)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run pi --version: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ── Application entrypoint ───────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Handle file argument (double-click or "Open with")
            if args.len() > 1 {
                let file_path = &args[1];
                let path = std::path::PathBuf::from(file_path);
                if path.exists() && path.is_file() {
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") {
                            if let Ok(content) = std::fs::read_to_string(&path) {
                                let path_str = path.to_string_lossy().to_string();
                                let _ = app.emit("file-opened", serde_json::json!({
                                    "path": path_str,
                                    "content": content
                                }));
                            }
                        }
                    }
                }
            }
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show();
                let _ = w.set_focus();
            });
        }))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                if let Ok(pos) = window.outer_position() {
                    if let Ok(size) = window.outer_size() {
                        let maximized = window.is_maximized().unwrap_or(false);
                        if let Some(state) = app.try_state::<AppState>() {
                            if let Ok(mut config) = state.app_config.write() {
                                let settings = config.settings.get_or_insert_with(Settings::default);
                                settings.window_maximized = Some(maximized);
                                if !maximized {
                                    settings.window_x = Some(pos.x);
                                    settings.window_y = Some(pos.y);
                                    settings.window_width = Some(size.width);
                                    settings.window_height = Some(size.height);
                                }
                                let _ = save_config(&config);
                            }
                        }
                    }
                }
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    if app.webview_windows().is_empty() {
                        app.exit(0);
                    }
                });
            }
        })
        .setup(|app| {
            app.manage(AppState {
                app_config: RwLock::new(load_config()),
                inline_session: Mutex::new(InlineSession { child: None }),
            });

            if let Some(main_window) = app.get_webview_window("main") {
                let config = load_config();
                if let Some(settings) = &config.settings {
                    if settings.window_maximized == Some(true) {
                        let _ = main_window.maximize();
                    } else if let (Some(x), Some(y), Some(w), Some(h)) = (
                        settings.window_x, settings.window_y,
                        settings.window_width, settings.window_height,
                    ) {
                        let _ = main_window.set_position(tauri::PhysicalPosition::new(x, y));
                        let _ = main_window.set_size(tauri::PhysicalSize::new(w, h));
                    }
                }
                let _ = main_window.show();

                // Handle file argument on first launch (double-click in Explorer)
                let args: Vec<String> = std::env::args().collect();
                if args.len() > 1 {
                    let file_path = &args[1];
                    let path = std::path::PathBuf::from(file_path);
                    if path.exists() && path.is_file() {
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") {
                                if let Ok(content) = std::fs::read_to_string(&path) {
                                    let path_str = path.to_string_lossy().to_string();
                                    let app_handle = app.handle().clone();
                                    // Delay slightly so frontend has time to mount
                                    std::thread::spawn(move || {
                                        std::thread::sleep(std::time::Duration::from_millis(500));
                                        let _ = app_handle.emit("file-opened", serde_json::json!({
                                            "path": path_str,
                                            "content": content
                                        }));
                                    });
                                }
                            }
                        }
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            list_theme_schemas,
            load_theme_css,
            copy_to_clipboard,
            open_file_dialog,
            read_file,
            write_file,
            save_file_dialog,
            open_in_file_manager,
            file_mtime,
            inline_generate,
            pi_check,
            pi_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
