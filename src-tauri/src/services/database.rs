//! Database service - rusqlite wrapper
//!
//! Opens the existing SQLite database and provides repository operations.

use rusqlite::{params, Connection, Result as SqlResult};
use std::path::PathBuf;
use std::sync::Mutex;
use tracing::{error, info};

use crate::services::migrations;

pub struct DatabaseService {
    conn: Mutex<Connection>,
}

impl DatabaseService {
    pub fn new(db_path: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
        )?;

        // Initialize schema version table
        migrations::ensure_schema_version_table(&conn)?;

        // Run all pending migrations
        migrations::run_migrations(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Run a read-only query with a closure
    pub fn query<T, F>(&self, sql: &str, f: F) -> SqlResult<T>
    where
        F: FnOnce(&mut rusqlite::Statement) -> SqlResult<T>,
    {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(sql)?;
        f(&mut stmt)
    }

    /// Run a mutation (INSERT/UPDATE/DELETE)
    pub fn execute(&self, sql: &str) -> SqlResult<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(sql, [])
    }

    /// Run a mutation with parameters
    pub fn execute_params(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> SqlResult<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(sql, params)
    }

    // ─── Session Repository ─────────────────────────────────────────────────

    pub fn list_sessions(&self, limit: i64) -> SqlResult<Vec<SessionRow>> {
        self.query(
            "SELECT id, name, status, provider_id, is_pinned, started_at, ended_at
             FROM sessions
             ORDER BY is_pinned DESC, started_at DESC
             LIMIT ?",
            |stmt| {
                let mut rows = stmt.query(params![limit])?;
                let mut result = Vec::new();
                while let Some(row) = rows.next()? {
                    result.push(SessionRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        status: row.get(2)?,
                        provider_id: row.get(3)?,
                        is_pinned: row.get::<_, i32>(4)? != 0,
                        started_at: row.get(5)?,
                        ended_at: row.get(6)?,
                    });
                }
                Ok(result)
            },
        )
    }

    pub fn get_session(&self, id: &str) -> SqlResult<Option<SessionRow>> {
        self.query(
            "SELECT id, name, status, provider_id, is_pinned, started_at, ended_at
             FROM sessions WHERE id = ?",
            |stmt| {
                let mut rows = stmt.query(params![id])?;
                if let Some(row) = rows.next()? {
                    Ok(Some(SessionRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        status: row.get(2)?,
                        provider_id: row.get(3)?,
                        is_pinned: row.get::<_, i32>(4)? != 0,
                        started_at: row.get(5)?,
                        ended_at: row.get(6)?,
                    }))
                } else {
                    Ok(None)
                }
            },
        )
    }

    pub fn get_session_config(&self, id: &str) -> SqlResult<Option<String>> {
        self.query(
            "SELECT config FROM sessions WHERE id = ?",
            |stmt| {
                let mut rows = stmt.query(params![id])?;
                if let Some(row) = rows.next()? {
                    Ok(Some(row.get(0)?))
                } else {
                    Ok(None)
                }
            },
        )
    }

    /// Create a new session
    pub fn create_session(
        &self,
        id: &str,
        name: &str,
        status: &str,
        provider_id: Option<&str>,
        config: Option<&str>,
    ) -> SqlResult<()> {
        self.execute_params(
            "INSERT INTO sessions (id, name, status, provider_id, config, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
            &[&id, &name, &status, &provider_id, &config],
        )?;
        Ok(())
    }

    /// Update session status
    pub fn update_session_status(&self, id: &str, status: &str) -> SqlResult<()> {
        self.execute_params(
            "UPDATE sessions SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
            &[&status, &id],
        )?;
        Ok(())
    }

    /// Update session ended_at
    pub fn end_session(&self, id: &str) -> SqlResult<()> {
        self.execute_params(
            "UPDATE sessions SET status = 'completed', ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
            &[&id],
        )?;
        Ok(())
    }

    /// Pin/unpin a session
    pub fn set_session_pinned(&self, id: &str, pinned: bool) -> SqlResult<()> {
        self.execute_params(
            "UPDATE sessions SET is_pinned = ?1, updated_at = datetime('now') WHERE id = ?2",
            &[&(pinned as i32), &id],
        )?;
        Ok(())
    }

    /// Rename a session
    pub fn rename_session(&self, id: &str, name: &str) -> SqlResult<()> {
        self.execute_params(
            "UPDATE sessions SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
            &[&name, &id],
        )?;
        Ok(())
    }

    /// Delete a session
    pub fn delete_session(&self, id: &str) -> SqlResult<()> {
        self.execute_params(
            "DELETE FROM sessions WHERE id = ?1",
            &[&id],
        )?;
        Ok(())
    }

    // ─── Provider Repository ─────────────────────────────────────────────────

    pub fn list_providers(&self) -> SqlResult<Vec<ProviderRow>> {
        self.query(
            "SELECT id, name, command, is_builtin, icon, api_base_url, api_key,
                    default_model, adapter_type, is_pinned, category, sort_order
             FROM ai_providers
             ORDER BY sort_order ASC, name ASC",
            |stmt| {
                let mut rows = stmt.query([])?;
                let mut result = Vec::new();
                while let Some(row) = rows.next()? {
                    result.push(ProviderRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        command: row.get(2)?,
                        is_builtin: row.get::<_, i32>(3)? != 0,
                        icon: row.get(4)?,
                        api_base_url: row.get(5)?,
                        api_key: row.get(6)?,
                        default_model: row.get(7)?,
                        adapter_type: row.get(8)?,
                        is_pinned: row.get::<_, i32>(9)? != 0,
                        category: row.get(10)?,
                        sort_order: row.get::<_, i32>(11)?,
                    });
                }
                Ok(result)
            },
        )
    }

    pub fn get_provider(&self, id: &str) -> SqlResult<Option<ProviderRow>> {
        self.query(
            "SELECT id, name, command, is_builtin, icon, api_base_url, api_key,
                    default_model, adapter_type, is_pinned, category, sort_order
             FROM ai_providers WHERE id = ?",
            |stmt| {
                let mut rows = stmt.query(params![id])?;
                if let Some(row) = rows.next()? {
                    Ok(Some(ProviderRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        command: row.get(2)?,
                        is_builtin: row.get::<_, i32>(3)? != 0,
                        icon: row.get(4)?,
                        api_base_url: row.get(5)?,
                        api_key: row.get(6)?,
                        default_model: row.get(7)?,
                        adapter_type: row.get(8)?,
                        is_pinned: row.get::<_, i32>(9)? != 0,
                        category: row.get(10)?,
                        sort_order: row.get::<_, i32>(11)?,
                    }))
                } else {
                    Ok(None)
                }
            },
        )
    }

    /// Add a new provider
    pub fn add_provider(
        &self,
        id: &str,
        name: &str,
        command: &str,
        is_builtin: bool,
        icon: Option<&str>,
        api_base_url: Option<&str>,
        api_key: Option<&str>,
        default_model: Option<&str>,
        adapter_type: Option<&str>,
        category: Option<&str>,
    ) -> SqlResult<()> {
        self.execute_params(
            "INSERT INTO ai_providers (
                id, name, command, is_builtin, icon, api_base_url, api_key,
                default_model, adapter_type, is_pinned, category, sort_order,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, 0, datetime('now'), datetime('now'))",
            &[
                &id, &name, &command, &(is_builtin as i32), &icon,
                &api_base_url, &api_key, &default_model, &adapter_type, &category,
            ],
        )?;
        Ok(())
    }

    /// Update provider
    /// TODO: Fix lifetime issues with dynamic SQL building
    pub fn update_provider(
        &self,
        id: &str,
        name: Option<&str>,
        command: Option<&str>,
        api_base_url: Option<&str>,
        api_key: Option<&str>,
        default_model: Option<&str>,
        icon: Option<&str>,
        category: Option<&str>,
    ) -> SqlResult<()> {
        // Temporary implementation: use individual UPDATE statements
        if let Some(name) = name {
            self.execute_params(
                "UPDATE ai_providers SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
                &[&name, &id],
            )?;
        }
        if let Some(command) = command {
            self.execute_params(
                "UPDATE ai_providers SET command = ?1, updated_at = datetime('now') WHERE id = ?2",
                &[&command, &id],
            )?;
        }
        if let Some(api_base_url) = api_base_url {
            self.execute_params(
                "UPDATE ai_providers SET api_base_url = ?1, updated_at = datetime('now') WHERE id = ?2",
                &[&api_base_url, &id],
            )?;
        }
        if let Some(api_key) = api_key {
            self.execute_params(
                "UPDATE ai_providers SET api_key = ?1, updated_at = datetime('now') WHERE id = ?2",
                &[&api_key, &id],
            )?;
        }
        if let Some(default_model) = default_model {
            self.execute_params(
                "UPDATE ai_providers SET default_model = ?1, updated_at = datetime('now') WHERE id = ?2",
                &[&default_model, &id],
            )?;
        }
        if let Some(icon) = icon {
            self.execute_params(
                "UPDATE ai_providers SET icon = ?1, updated_at = datetime('now') WHERE id = ?2",
                &[&icon, &id],
            )?;
        }
        if let Some(category) = category {
            self.execute_params(
                "UPDATE ai_providers SET category = ?1, updated_at = datetime('now') WHERE id = ?2",
                &[&category, &id],
            )?;
        }

        Ok(())
    }

    /// Delete a provider
    pub fn delete_provider(&self, id: &str) -> SqlResult<()> {
        self.execute_params(
            "DELETE FROM ai_providers WHERE id = ?1 AND is_builtin = 0",
            &[&id],
        )?;
        Ok(())
    }

    /// Pin/unpin a provider
    pub fn set_provider_pinned(&self, id: &str, pinned: bool) -> SqlResult<()> {
        self.execute_params(
            "UPDATE ai_providers SET is_pinned = ?1, updated_at = datetime('now') WHERE id = ?2",
            &[&(pinned as i32), &id],
        )?;
        Ok(())
    }

    /// Update provider sort order
    pub fn update_provider_sort_order(&self, id: &str, sort_order: i32) -> SqlResult<()> {
        self.execute_params(
            "UPDATE ai_providers SET sort_order = ?1, updated_at = datetime('now') WHERE id = ?2",
            &[&sort_order, &id],
        )?;
        Ok(())
    }

    // ─── Conversation Repository ─────────────────────────────────────────────

    pub fn list_conversations(&self, session_id: &str, limit: i64) -> SqlResult<Vec<ConversationRow>> {
        self.query(
            "SELECT id, session_id, role, content, timestamp
             FROM conversation_messages
             WHERE session_id = ?
             ORDER BY timestamp DESC
             LIMIT ?",
            |stmt| {
                let mut rows = stmt.query(params![session_id, limit])?;
                let mut result = Vec::new();
                while let Some(row) = rows.next()? {
                    result.push(ConversationRow {
                        id: row.get(0)?,
                        session_id: row.get(1)?,
                        role: row.get(2)?,
                        content: row.get(3)?,
                        timestamp: row.get(4)?,
                    });
                }
                Ok(result)
            },
        )
    }

    /// Insert a conversation message
    pub fn insert_conversation(
        &self,
        id: &str,
        session_id: &str,
        role: &str,
        content: &str,
        message_type: Option<&str>,
        tool_name: Option<&str>,
        tool_input: Option<&str>,
        tool_result: Option<&str>,
        is_error: bool,
        thinking_text: Option<&str>,
        usage_input_tokens: Option<i32>,
        usage_output_tokens: Option<i32>,
    ) -> SqlResult<()> {
        self.execute_params(
            "INSERT INTO conversation_messages (
                id, session_id, role, type, content, timestamp,
                tool_name, tool_input, tool_result, is_error,
                thinking_text, usage_input_tokens, usage_output_tokens
            ) VALUES (?1, ?2, ?3, COALESCE(?4, 'text'), ?5, datetime('now'),
                      ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            &[
                &id, &session_id, &role, &message_type, &content,
                &tool_name, &tool_input, &tool_result, &(is_error as i32),
                &thinking_text, &usage_input_tokens, &usage_output_tokens,
            ],
        )?;
        Ok(())
    }

    /// Update a conversation message
    pub fn update_conversation(&self, id: &str, content: &str) -> SqlResult<()> {
        self.execute_params(
            "UPDATE conversation_messages SET content = ?1 WHERE id = ?2",
            &[&content, &id],
        )?;
        Ok(())
    }

    /// Delete a conversation message
    pub fn delete_conversation(&self, id: &str) -> SqlResult<()> {
        self.execute_params(
            "DELETE FROM conversation_messages WHERE id = ?1",
            &[&id],
        )?;
        Ok(())
    }

    /// Clear all conversations for a session
    pub fn clear_session_conversations(&self, session_id: &str) -> SqlResult<()> {
        self.execute_params(
            "DELETE FROM conversation_messages WHERE session_id = ?1",
            &[&session_id],
        )?;
        Ok(())
    }

    // ─── Task Repository ────────────────────────────────────────────────────

    pub fn list_tasks(&self, limit: i64) -> SqlResult<Vec<TaskRow>> {
        self.query(
            "SELECT id, title, status, priority, workspace_id, created_at
             FROM tasks
             ORDER BY created_at DESC
             LIMIT ?",
            |stmt| {
                let mut rows = stmt.query(params![limit])?;
                let mut result = Vec::new();
                while let Some(row) = rows.next()? {
                    result.push(TaskRow {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        status: row.get(2)?,
                        priority: row.get(3)?,
                        workspace_id: row.get(4)?,
                        created_at: row.get(5)?,
                    });
                }
                Ok(result)
            },
        )
    }

    // ─── Settings Repository ────────────────────────────────────────────────

    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        self.query(
            "SELECT value FROM app_settings WHERE key = ?",
            |stmt| {
                let mut rows = stmt.query(params![key])?;
                if let Some(row) = rows.next()? {
                    Ok(Some(row.get(0)?))
                } else {
                    Ok(None)
                }
            },
        )
    }

    /// Set a setting value (insert or update)
    pub fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        self.execute_params(
            "INSERT INTO app_settings (key, value, updated_at)
             VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')",
            &[&key, &value],
        )?;
        Ok(())
    }

    /// Delete a setting
    pub fn delete_setting(&self, key: &str) -> SqlResult<()> {
        self.execute_params(
            "DELETE FROM app_settings WHERE key = ?1",
            &[&key],
        )?;
        Ok(())
    }

    // ─── Task Repository Write Operations ────────────────────────────────────

    /// Create a new task
    pub fn create_task(
        &self,
        id: &str,
        title: &str,
        status: &str,
        priority: Option<i32>,
        workspace_id: Option<&str>,
    ) -> SqlResult<()> {
        self.execute_params(
            "INSERT INTO tasks (id, title, status, priority, workspace_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
            &[&id, &title, &status, &priority, &workspace_id],
        )?;
        Ok(())
    }

    /// Update task status
    pub fn update_task_status(&self, id: &str, status: &str) -> SqlResult<()> {
        self.execute_params(
            "UPDATE tasks SET status = ?1 WHERE id = ?2",
            &[&status, &id],
        )?;
        Ok(())
    }

    /// Delete a task
    pub fn delete_task(&self, id: &str) -> SqlResult<()> {
        self.execute_params(
            "DELETE FROM tasks WHERE id = ?1",
            &[&id],
        )?;
        Ok(())
    }

    // ─── Transaction Support ────────────────────────────────────────────────

    /// Execute multiple operations in a transaction
    pub fn transaction<F, T>(&self, f: F) -> Result<T, Box<dyn std::error::Error>>
    where
        F: FnOnce(&Connection) -> Result<T, Box<dyn std::error::Error>>,
    {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        
        let result = f(&tx)?;
        
        tx.commit()?;
        Ok(result)
    }

    // ─── Schema Info ───────────────────────────────────────────────────────

    pub fn get_schema_version(&self) -> SqlResult<i64> {
        self.query(
            "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
            |stmt| {
                let mut rows = stmt.query([])?;
                if let Some(row) = rows.next()? {
                    Ok(row.get(0)?)
                } else {
                    Ok(0i64)
                }
            },
        )
    }
}

// ─── Row Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionRow {
    pub id: String,
    pub name: String,
    pub status: String,
    pub provider_id: Option<String>,
    pub is_pinned: bool,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderRow {
    pub id: String,
    pub name: String,
    pub command: String,
    pub is_builtin: bool,
    pub icon: Option<String>,
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub default_model: Option<String>,
    pub adapter_type: Option<String>,
    pub is_pinned: bool,
    pub category: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConversationRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TaskRow {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: Option<i32>,
    pub workspace_id: Option<String>,
    pub created_at: String,
}
