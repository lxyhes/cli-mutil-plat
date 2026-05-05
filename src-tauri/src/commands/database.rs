//! Database commands - rusqlite repository operations exposed as Tauri commands

use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

use crate::services::database::{ProviderRow, SessionRow, TaskRow};
use crate::services::database::DatabaseService as DbSvc;

pub type DbState = Arc<RwLock<DbSvc>>;

#[tauri::command]
pub async fn db_list_sessions(
    db: State<'_, DbState>,
    limit: Option<i64>,
) -> Result<Vec<SessionRow>, String> {
    let db = db.read().await;
    db.list_sessions(limit.unwrap_or(50))
        .map_err(|e| format!("Failed to list sessions: {}", e))
}

#[tauri::command]
pub async fn db_get_session(
    db: State<'_, DbState>,
    id: String,
) -> Result<Option<SessionRow>, String> {
    let db = db.read().await;
    db.get_session(&id)
        .map_err(|e| format!("Failed to get session: {}", e))
}

#[tauri::command]
pub async fn db_list_providers(db: State<'_, DbState>) -> Result<Vec<ProviderRow>, String> {
    let db = db.read().await;
    db.list_providers()
        .map_err(|e| format!("Failed to list providers: {}", e))
}

#[tauri::command]
pub async fn db_get_provider(
    db: State<'_, DbState>,
    id: String,
) -> Result<Option<ProviderRow>, String> {
    let db = db.read().await;
    db.get_provider(&id)
        .map_err(|e| format!("Failed to get provider: {}", e))
}

#[tauri::command]
pub async fn db_list_tasks(
    db: State<'_, DbState>,
    limit: Option<i64>,
) -> Result<Vec<TaskRow>, String> {
    let db = db.read().await;
    db.list_tasks(limit.unwrap_or(50))
        .map_err(|e| format!("Failed to list tasks: {}", e))
}

#[tauri::command]
pub async fn db_get_setting(
    db: State<'_, DbState>,
    key: String,
) -> Result<Option<String>, String> {
    let db = db.read().await;
    db.get_setting(&key)
        .map_err(|e| format!("Failed to get setting: {}", e))
}

#[tauri::command]
pub async fn db_get_schema_version(db: State<'_, DbState>) -> Result<i64, String> {
    let db = db.read().await;
    db.get_schema_version()
        .map_err(|e| format!("Failed to get schema version: {}", e))
}
