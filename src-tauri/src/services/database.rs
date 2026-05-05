//! Database service - rusqlite wrapper
//!
//! Opens the existing SQLite database and provides repository operations.

use rusqlite::{params, Connection, Result as SqlResult};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DatabaseService {
    conn: Mutex<Connection>,
}

impl DatabaseService {
    pub fn new(db_path: PathBuf) -> SqlResult<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
        )?;
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
