//! Team commands - multi-agent team management

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub status: String,
}

#[tauri::command]
pub fn get_all_teams() -> Result<Vec<Team>, String> {
    // TODO: Load teams from database
    Ok(vec![])
}
