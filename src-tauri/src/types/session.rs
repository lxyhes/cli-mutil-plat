//! Session type definitions

use serde::{Deserialize, Serialize};

/// Session status enum
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
}

/// Session info returned to the renderer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub status: SessionStatus,
    pub provider: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Session config for creating a new session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub name: String,
    pub provider_type: String,
    pub model: Option<String>,
    pub cwd: Option<String>,
}
