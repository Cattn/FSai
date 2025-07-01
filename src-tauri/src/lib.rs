use tauri::{Manager, State, Emitter};
use tauri_plugin_shell::{ShellExt, process::CommandEvent, process::CommandChild};
use std::sync::Mutex;

struct AppState {
    backend_port: Mutex<Option<u16>>,
    child_process: Mutex<Option<CommandChild>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            backend_port: Mutex::new(None),
            child_process: Mutex::new(None),
        }
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn get_backend_port(state: State<'_, AppState>) -> Result<Option<u16>, String> {
    let port = state.backend_port.lock().unwrap();
    Ok(*port)
}

#[tauri::command] 
async fn start_backend(app_handle: tauri::AppHandle) -> Result<(), String> {
    let sidecar_command = app_handle
        .shell()
        .sidecar("server")
        .expect("failed to create `server` binary command");
    
    let (mut rx, child) = sidecar_command
        .spawn()
        .expect("Failed to spawn sidecar");
    
    // Store the child process in the state
    let app_state = app_handle.state::<AppState>();
    *app_state.child_process.lock().unwrap() = Some(child);
    
    // Listen for port output
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
                let line_str = String::from_utf8_lossy(&line);
                if line_str.starts_with("BACKEND_PORT:") {
                    if let Ok(port) = line_str.replace("BACKEND_PORT:", "").trim().parse::<u16>() {
                        {
                            let app_state = app_handle_clone.state::<AppState>();
                            let mut backend_port = app_state.backend_port.lock().unwrap();
                            *backend_port = Some(port);
                        }
                        
                        // Emit event to frontend
                        app_handle_clone.emit("backend-ready", port).unwrap();
                        println!("Backend started on port: {}", port);
                    }
                } else {
                    println!("[sidecar stdout]: {}", line_str);
                }
            } else if let CommandEvent::Stderr(line) = event {
                let line_str = String::from_utf8_lossy(&line);
                eprintln!("[sidecar stderr]: {}", line_str);
            }
        }
    });
    
    Ok(())
}

#[tauri::command]
async fn stop_backend(state: State<'_, AppState>) -> Result<(), String> {
    let mut child_process = state.child_process.lock().unwrap();
    if let Some(child) = child_process.take() {
        child.kill().map_err(|e| format!("Failed to kill backend process: {}", e))?;
        println!("Backend process terminated");
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![greet, start_backend, get_backend_port, stop_backend])
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // Auto-start backend
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_backend(app_handle).await {
                    eprintln!("Failed to start backend: {}", e);
                }
            });
            
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    let app_state = window.state::<AppState>();
                    let mut child_process = app_state.child_process.lock().unwrap();
                    if let Some(child) = child_process.take() {
                        if let Err(e) = child.kill() {
                            eprintln!("Failed to kill backend process on window close: {}", e);
                        } else {
                            println!("Backend process terminated on window close");
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
