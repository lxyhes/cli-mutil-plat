//! PrismOps binary-level command handlers
//!
//! Commands defined here have access to the binary crate's macros.
//! They delegate to library services for actual implementation.

use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::RwLock;
use tracing::info;

use prismops_lib::services::database::{ProviderRow, SessionRow, TaskRow, DatabaseService};

// ─── State type ───────────────────────────────────────────────────────────────

pub type DbState = Arc<RwLock<DatabaseService>>;

// ─── Database Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_list_sessions(
    db: State<'_, DbState>,
    limit: Option<i64>,
) -> Result<Vec<SessionRow>, String> {
    let db = db.read().await;
    db.list_sessions(limit.unwrap_or(50))
        .map_err(|e| format!("list_sessions error: {}", e))
}

#[tauri::command]
pub async fn db_get_session(
    db: State<'_, DbState>,
    id: String,
) -> Result<Option<SessionRow>, String> {
    let db = db.read().await;
    db.get_session(&id)
        .map_err(|e| format!("get_session error: {}", e))
}

#[tauri::command]
pub async fn db_list_providers(db: State<'_, DbState>) -> Result<Vec<ProviderRow>, String> {
    let db = db.read().await;
    db.list_providers()
        .map_err(|e| format!("list_providers error: {}", e))
}

#[tauri::command]
pub async fn db_get_provider(
    db: State<'_, DbState>,
    id: String,
) -> Result<Option<ProviderRow>, String> {
    let db = db.read().await;
    db.get_provider(&id)
        .map_err(|e| format!("get_provider error: {}", e))
}

#[tauri::command]
pub async fn db_list_tasks(
    db: State<'_, DbState>,
    limit: Option<i64>,
) -> Result<Vec<TaskRow>, String> {
    let db = db.read().await;
    db.list_tasks(limit.unwrap_or(50))
        .map_err(|e| format!("list_tasks error: {}", e))
}

#[tauri::command]
pub async fn db_get_setting(
    db: State<'_, DbState>,
    key: String,
) -> Result<Option<String>, String> {
    let db = db.read().await;
    db.get_setting(&key)
        .map_err(|e| format!("get_setting error: {}", e))
}

#[tauri::command]
pub async fn db_get_schema_version(db: State<'_, DbState>) -> Result<i64, String> {
    let db = db.read().await;
    db.get_schema_version()
        .map_err(|e| format!("get_schema_version error: {}", e))
}

// ─── App Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "PrismOps",
        "version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

#[tauri::command]
pub fn get_home_path() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}
