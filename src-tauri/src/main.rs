//! PrismOps - Tauri + Rust Entry Point
//!
//! Entry point for the Tauri application.
//! Memory allocator: mimalloc on Windows for lower memory usage and fewer GC pauses.

#![cfg_attr(not(feature = "custom-protocol"), windows_subsystem = "windows")]

#[cfg(windows)]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use std::panic;
use tracing::{error, info, Level};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

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

    // Get app data directory for logs
    let log_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("PrismOps")
        .join("logs");

    // Create log directory if it doesn't exist
    std::fs::create_dir_all(&log_dir).ok();

    // Set up file logging with rotation
    let file_appender = RollingFileAppender::new(Rotation::DAILY, log_dir, "prismops.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Initialize tracing subscriber
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,prismops=debug"));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(std::io::stdout).with_ansi(true))
        .with(fmt::layer().with_writer(non_blocking).with_ansi(false))
        .init();

    info!("PrismOps starting up");
    info!("Version: {}", env!("CARGO_PKG_VERSION"));

    // Build and run Tauri app
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("prismops".into()) },
                ))
                .level(Level::INFO)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        .menu_on_left_click(false)
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
    app.global_shortcut().on_shortcut(view_grid, move |_app, shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            if let Some(window) = app_handle.get_webview_window("main") {
                window.emit("shortcut:view-grid", ()).ok();
            }
        }
    })?;

    let app_handle = app.clone();
    app.global_shortcut().on_shortcut(view_tabs, move |_app, shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            if let Some(window) = app_handle.get_webview_window("main") {
                window.emit("shortcut:view-tabs", ()).ok();
            }
        }
    })?;

    let app_handle = app.clone();
    app.global_shortcut().on_shortcut(view_dashboard, move |_app, shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            if let Some(window) = app_handle.get_webview_window("main") {
                window.emit("shortcut:view-dashboard", ()).ok();
            }
        }
    })?;

    app.global_shortcut().register(new_session)?;
    app.global_shortcut().register(view_grid)?;
    app.global_shortcut().register(view_tabs)?;
    app.global_shortcut().register(view_dashboard)?;

    info!("Global shortcuts registered");
    Ok(())
}
