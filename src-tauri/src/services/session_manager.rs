//! Session manager service
//!
//! This will be the Rust equivalent of SessionManagerV2.

use std::sync::Arc;
use tokio::sync::RwLock;

pub struct SessionManager {
    sessions: Arc<RwLock<std::collections::HashMap<String, SessionState>>>,
}

#[derive(Debug, Clone)]
pub struct SessionState {
    pub id: String,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SessionStatus {
    Created,
    Running,
    Waiting,
    Completed,
    Failed,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    pub async fn create_session(&self, id: String) {
        self.sessions.write().await.insert(id.clone(), SessionState {
            id,
            status: SessionStatus::Created,
        });
    }

    pub async fn get_status(&self, id: &str) -> Option<SessionStatus> {
        self.sessions.read().await.get(id).map(|s| s.status)
    }
}
