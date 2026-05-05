//! PTY service - portable-pty wrapper for terminal emulation
//!
//! This will replace node-pty in Phase 2.

use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, PtyPair>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create_session(
        &self,
        shell: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 })?;

        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(cwd);

        let _child = pair.slave.spawn_command(cmd)?;
        let session_id = uuid::Uuid::new_v4().to_string();

        self.sessions.write().await.insert(session_id.clone(), pair);

        Ok(session_id)
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let sessions = self.sessions.read().await;
        if let Some(pair) = sessions.get(session_id) {
            pair.master.resize(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 })?;
        }
        Ok(())
    }

    pub async fn kill(&self, session_id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.sessions.write().await.remove(session_id);
        Ok(())
    }
}
