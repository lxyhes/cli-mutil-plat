//! Event type definitions for Tauri event bus

use serde::{Deserialize, Serialize};

/// App lifecycle event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppEvent {
    pub kind: String,
    pub payload: serde_json::Value,
}

/// Terminal output event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub session_id: String,
    pub data: String,
}

/// Session state change event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEvent {
    pub session_id: String,
    pub status: String,
}
