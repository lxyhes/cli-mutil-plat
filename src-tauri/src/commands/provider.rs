//! Provider commands - AI provider CRUD

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub command: String,
    pub is_builtin: bool,
}

#[tauri::command]
pub fn get_all_providers() -> Result<Vec<Provider>, String> {
    // TODO: Load from rusqlite database
    // For now, return built-in providers from the Rust side
    Ok(vec![
        Provider {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            is_builtin: true,
        },
        Provider {
            id: "codex".to_string(),
            name: "Codex CLI".to_string(),
            command: "codex".to_string(),
            is_builtin: true,
        },
        Provider {
            id: "gemini-cli".to_string(),
            name: "Gemini CLI".to_string(),
            command: "gemini".to_string(),
            is_builtin: true,
        },
        Provider {
            id: "qwen-coder".to_string(),
            name: "Qwen Coder".to_string(),
            command: "qwen".to_string(),
            is_builtin: true,
        },
    ])
}

#[tauri::command]
pub fn get_provider(id: String) -> Result<Provider, String> {
    let providers = get_all_providers()?;
    providers
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Provider not found: {}", id))
}
