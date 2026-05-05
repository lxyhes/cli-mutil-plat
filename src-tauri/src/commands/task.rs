//! Task commands - task management

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
}

#[tauri::command]
pub fn get_all_tasks() -> Result<Vec<Task>, String> {
    // TODO: Load tasks from database
    Ok(vec![])
}

#[tauri::command]
pub fn create_task(title: String, description: Option<String>) -> Result<Task, String> {
    // TODO: Create task in database
    Ok(Task {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        status: "todo".to_string(),
        priority: "medium".to_string(),
    })
}
