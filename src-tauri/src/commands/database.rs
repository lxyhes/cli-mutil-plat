//! Database commands - wrapper around rusqlite repository operations

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn db_query(sql: String, params: Vec<serde_json::Value>) -> Result<QueryResult, String> {
    // TODO: Initialize rusqlite connection and execute query
    // This will be implemented in Phase 1 (Database Migration)
    Ok(QueryResult {
        success: true,
        data: None,
        error: Some("Database not yet migrated to Rust".to_string()),
    })
}

#[tauri::command]
pub fn db_execute(sql: String, params: Vec<serde_json::Value>) -> Result<QueryResult, String> {
    // TODO: Initialize rusqlite connection and execute statement
    Ok(QueryResult {
        success: true,
        data: None,
        error: Some("Database not yet migrated to Rust".to_string()),
    })
}
