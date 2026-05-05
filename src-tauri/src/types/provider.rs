//! Provider type definitions

use serde::{Deserialize, Serialize};

/// AI Provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub enabled: bool,
    pub is_pinned: bool,
    pub category: Option<String>,
}

impl Default for Provider {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            provider_type: String::new(),
            api_key: None,
            base_url: None,
            model: None,
            enabled: true,
            is_pinned: false,
            category: None,
        }
    }
}
