//! PTY service - portable-pty wrapper for terminal emulation
//!
//! Phase 2: Replace node-pty with Rust implementation.
//! Features:
//! - PTY session management
//! - ANSI escape sequence parsing
//! - Output streaming to frontend
//! - Shell integration

use crate::services::ansi_parser::{AnsiEvent, AnsiParser};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, error, info, warn};

/// Maximum output buffer size per session (characters)
const MAX_OUTPUT_BUFFER_SIZE: usize = 50000;

/// PTY Session information
pub struct PtySession {
    /// PTY master handle
    pub master: Box<dyn MasterPty + Send>,
    /// Output channel sender
    pub tx: mpsc::Sender<String>,
    /// ANSI parser instance
    pub parser: AnsiParser,
    /// Output buffer (circular)
    pub output_buffer: String,
}

pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a new PTY session
    /// 
    /// # Arguments
    /// * `shell` - Shell executable path (e.g., "bash", "cmd.exe")
    /// * `cwd` - Working directory
    /// * `cols` - Terminal columns
    /// * `rows` - Terminal rows
    /// * `output_callback` - Callback function for output events
    /// 
    /// # Returns
    /// Session ID
    pub async fn create_session(
        &self,
        shell: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let pty_system = native_pty_system();
        let pair: PtyPair = pty_system.openpty(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(cwd);

        // Spawn the shell process
        let _child = pair.slave.spawn_command(cmd)?;
        
        let session_id = uuid::Uuid::new_v4().to_string();
        info!("Created PTY session {} with shell {} in {}", session_id, shell, cwd);

        // Create output channel
        let (tx, _rx) = mpsc::channel::<String>(100);

        // Store session
        let session = PtySession {
            master: pair.master,
            tx,
            parser: AnsiParser::new(),
            output_buffer: String::new(),
        };

        self.sessions.write().await.insert(session_id.clone(), session);

        // TODO: Start reading output in background (disabled due to Send trait issues)
        // let sessions = self.sessions.clone();
        // let sid = session_id.clone();
        // tokio::spawn(async move {
        //     Self::read_output_loop(&sessions, &sid).await;
        // });

        Ok(session_id)
    }

    /// Read output from PTY and parse ANSI sequences
    async fn read_output_loop(sessions: &Arc<RwLock<HashMap<String, PtySession>>>, session_id: &str) {
        let reader = {
            let sessions_read = sessions.read().await;
            if let Some(session) = sessions_read.get(session_id) {
                match session.master.try_clone_reader() {
                    Ok(reader) => Some(reader),
                    Err(e) => {
                        error!("Failed to clone PTY reader for {}: {}", session_id, e);
                        None
                    }
                }
            } else {
                None
            }
        };

        if let Some(mut reader) = reader {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF - PTY closed
                        info!("PTY session {} closed (EOF)", session_id);
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        
                        // Process through ANSI parser
                        let _events = {
                            let mut sessions_write = sessions.write().await;
                            if let Some(session) = sessions_write.get_mut(session_id) {
                                let events = session.parser.parse_str(&data);
                                
                                // Update output buffer (circular)
                                session.output_buffer.push_str(&data);
                                if session.output_buffer.len() > MAX_OUTPUT_BUFFER_SIZE {
                                    let excess = session.output_buffer.len() - MAX_OUTPUT_BUFFER_SIZE;
                                    session.output_buffer.drain(..excess);
                                }
                                
                                events
                            } else {
                                break;
                            }
                        };

                        // Send parsed events to channel
                        let mut sessions_write = sessions.write().await;
                        if let Some(session) = sessions_write.get_mut(session_id) {
                            // For now, just send raw text
                            // In production, you'd send structured events
                            if let Err(e) = session.tx.send(data.clone()).await {
                                warn!("Failed to send output for {}: {}", session_id, e);
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Error reading from PTY {}: {}", session_id, e);
                        break;
                    }
                }
            }

            // Clean up session
            sessions.write().await.remove(session_id);
            info!("PTY session {} cleaned up", session_id);
        }
    }

    /// Write input to PTY session
    pub async fn write_input(
        &self,
        session_id: &str,
        data: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(session_id) {
            let mut writer = session.master.take_writer()?;
            writer.write_all(data.as_bytes())?;
            debug!("Wrote {} bytes to PTY {}", data.len(), session_id);
        } else {
            return Err(format!("Session {} not found", session_id).into());
        }
        Ok(())
    }

    /// Resize PTY session
    pub async fn resize(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(session_id) {
            session.master.resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })?;
            debug!("Resized PTY {} to {}x{}", session_id, cols, rows);
        }
        Ok(())
    }

    /// Kill PTY session
    pub async fn kill(&self, session_id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.sessions.write().await.remove(session_id);
        info!("Killed PTY session {}", session_id);
        Ok(())
    }

    /// Get output buffer for session
    pub async fn get_output_buffer(&self, session_id: &str) -> Option<String> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).map(|s| s.output_buffer.clone())
    }

    /// Strip ANSI codes from text (utility function)
    pub fn strip_ansi(text: &str) -> String {
        AnsiParser::strip_ansi(text)
    }
}
