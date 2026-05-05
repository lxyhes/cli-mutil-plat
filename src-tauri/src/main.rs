//! PrismOps - Tauri + Rust Entry Point
//!
//! Entry point for the Tauri application.
//! Memory allocator: mimalloc on Windows for lower memory usage and fewer GC pauses.

#![cfg_attr(not(feature = "custom-protocol"), windows_subsystem = "windows")]

#[cfg(windows)]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod commands;

use std::panic;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::RwLock;
use tracing::{error, info};

use prismops_lib::services::database::DatabaseService;
use crate::commands::{DbState, db_get_provider, db_get_schema_version, db_get_session,
    db_get_setting, db_list_providers, db_list_sessions, db_list_tasks};

fn main() {
    // Set up panic hook for better error reporting
    panic::set_hook(Box::new(|panic_info| {
        let location = panic_info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_else(|| "unknown".to_string());
        let message = panic_info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| panic_info.payload().downcast_ref::<String>().cloned()).unwrap_or_else(|| "Unknown panic".to_string());
        error!(
            target: "panic",
            location = %location,
            message = %message,
            "Application panic occurred"
        );
        eprintln!("[PANIC] {} at {}", message, location);
    }));

    info!("PrismOps starting up");

    // Build and run Tauri app
    let result = tauri::Builder::default()
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
            // Open database in setup so we can log errors
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
        .invoke(tauri::generate_handler![
            db_list_sessions,
            db_get_session,
            db_list_providers,
            db_get_provider,
            db_list_tasks,
            db_get_setting,
            db_get_schema_version,
            crate::commands::get_app_info,
            crate::commands::get_home_path,
        ])
        .setup(|app| {
            info!("PrismOps setup complete");

            // Set up system tray
            setup_tray(app.handle())?;

            // Set up global shortcuts
            setup_shortcuts(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide window instead of closing when clicking X
                // User can quit from tray menu
                window.hide().ok();
                api.prevent_close();
                info!("Main window hidden to tray");
            }
        })
        .run(tauri::generate_context!());

    match result {
        Ok(_) => info!("PrismOps exited normally"),
        Err(e) => {
            error!(error = %e, "PrismOps failed to start");
            eprintln!("[ERROR] Failed to start PrismOps: {}", e);
            std::process::exit(1);
        }
    }
}

/// Set up system tray icon and menu
fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let _tray = TrayIconBuilder::new()
        .tooltip("PrismOps - AI 会话工作台")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        window.show().ok();
                        window.set_focus().ok();
                    }
                }
                "quit" => {
                    info!("Quit requested from tray menu");
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        window.hide().ok();
                    } else {
                        window.show().ok();
                        window.set_focus().ok();
                    }
                }
            }
        })
        .build(app)?;

    info!("System tray initialized");
    Ok(())
}

/// Set up global keyboard shortcuts
fn setup_shortcuts(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

    // Ctrl+Shift+N: New session
    let new_session = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);
    // Ctrl+1: Switch to grid view
    let view_grid = Shortcut::new(Some(Modifiers::CONTROL), Code::Digit1);
    // Ctrl+2: Switch to tabs view
    let view_tabs = Shortcut::new(Some(Modifiers::CONTROL), Code::Digit2);
    // Ctrl+3: Switch to dashboard view
    let view_dashboard = Shortcut::new(Some(Modifiers::CONTROL), Code::Digit3);

    let app_handle = app.clone();
    app.global_shortcut().on_shortcut(new_session, move |_app, shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            info!("Global shortcut pressed: {:?}", shortcut);
            if let Some(window) = app_handle.get_webview_window("main") {
                window.emit("shortcut:new-session", ()).ok();
            }
        }
    })?;

    let app_handle = app.clone();
    app.global_shortcut().on_shortcut(view_grid, move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            if let Some(window) = app_handle.get_webview_window("main") {
                window.emit("shortcut:view-grid", ()).ok();
            }
        }
    })?;

    let app_handle = app.clone();
    app.global_shortcut().on_shortcut(view_tabs, move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            if let Some(window) = app_handle.get_webview_window("main") {
                window.emit("shortcut:view-tabs", ()).ok();
            }
        }
    })?;

    let app_handle = app.clone();
    app.global_shortcut().on_shortcut(view_dashboard, move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            if let Some(window) = app_handle.get_webview_window("main") {
                window.emit("shortcut:view-dashboard", ()).ok();
            }
        }
    })?;

    info!("Global shortcuts registered");
    Ok(())
}

/// Returns the path to the PrismOps/SpectrAI SQLite database file.
/// Uses SpectrAI's path for Phase 1 to share the existing database.
fn get_app_db_path() -> PathBuf {
    let app_data = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    // Phase 1: share the SpectrAI database to avoid migration complexity
    let spectr_dir = app_data.join("spectrai");
    std::fs::create_dir_all(&spectr_dir).ok();
    spectr_dir.join("claudeops.db")
}
