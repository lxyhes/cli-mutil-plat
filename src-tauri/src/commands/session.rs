//! Session commands - session lifecycle management
//!
//! These commands wrap the SessionManagerV2 service.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionConfig {
    pub provider_id: String,
    pub working_directory: String,
    pub name: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub status: String,
    pub provider_id: String,
}

#[tauri::command]
pub async fn create_session(config: SessionConfig) -> Result<SessionInfo, String> {
    // TODO: Implement session creation via adapter registry
    // This will be implemented in Phase 6 (Service Migration)
    let session_id = uuid::Uuid::new_v4().to_string();
    Ok(SessionInfo {
        id: session_id,
        name: config.name,
        status: "created".to_string(),
        provider_id: config.provider_id,
    })
}

#[tauri::command]
pub async fn terminate_session(_session_id: String) -> Result<(), String> {
    // TODO: Implement session termination
    Ok(())
}

#[tauri::command]
pub async fn send_input(_session_id: String, _input: String) -> Result<(), String> {
    // TODO: Send input to session
    Ok(())
}

#[tauri::command]
pub fn get_all_sessions() -> Result<Vec<SessionInfo>, String> {
    // TODO: Get sessions from database
    Ok(vec![])
}
