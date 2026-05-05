//! PrismOps - Tauri + Rust Main Process Library
//!
//! This is the Rust rewrite of the Electron main process.
//! Architecture: Tauri app with Rust backend + Node.js sidecar for Claude SDK.

pub mod commands;
pub mod services;
pub mod types;

/// Initialize Tauri application with all plugins and commands
pub fn init_app() -> tauri::Builder<tauri::Wry> {
    use std::path::PathBuf;
    use std::sync::Arc;
    use tokio::sync::RwLock;
    use tracing::{error, info};
    
    use crate::services::database::DatabaseService;
    use crate::commands::database::{db_get_provider, db_get_schema_version, db_get_session,
        db_get_setting, db_list_providers, db_list_sessions, db_list_tasks};
    use crate::commands::app::{get_app_info, get_home_path};
    
    // Helper function to get database path
    fn get_app_db_path() -> std::path::PathBuf {
        let app_data_dir = dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("PrismOps");
        std::fs::create_dir_all(&app_data_dir).ok();
        app_data_dir.join("prismops.db")
    }
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("prismops".into()) },
                ))
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Arc::new(RwLock::new({
            let db_path = get_app_db_path();
            info!("Opening database at: {:?}", db_path);
            match DatabaseService::new(db_path) {
                Ok(db) => {
                    let version = db.get_schema_version().unwrap_or(0);
                    info!("Database schema version: {}", version);
                    db
                }
                Err(e) => {
                    error!("Failed to open database: {}", e);
                    panic!("Cannot start without database: {}", e);
                }
            }
        })))
        .invoke_handler(tauri::generate_handler![
            db_list_sessions,
            db_get_session,
            db_list_providers,
            db_get_provider,
            db_list_tasks,
            db_get_setting,
            db_get_schema_version,
            get_app_info,
            get_home_path,
        ])
}
