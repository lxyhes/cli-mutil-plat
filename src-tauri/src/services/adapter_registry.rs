//! Adapter registry - routes providers to their respective adapters
//!
//! Phase 4: Manage multiple AI provider adapters.
//! Supports dynamic registration and routing based on provider ID.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// Provider adapter trait
#[async_trait::async_trait]
pub trait ProviderAdapter: Send + Sync {
    /// Provider ID (e.g., "openai", "claude-code", "codex")
    fn provider_id(&self) -> &str;
    
    /// Display name (e.g., "OpenAI", "Claude Code")
    fn display_name(&self) -> &str;
    
    /// Start a new session
    async fn start_session(&self, session_id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    
    /// Send a message
    async fn send_message(&self, session_id: &str, message: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    
    /// Abort current turn
    async fn abort_turn(&self, session_id: &str) -> Result<(), String>;
    
    /// Terminate session
    async fn terminate_session(&self, session_id: &str) -> Result<(), String>;
    
    /// Check if session exists
    async fn has_session(&self, session_id: &str) -> bool;
}

pub struct AdapterRegistry {
    /// Registered adapters: provider_id -> adapter
    adapters: Arc<RwLock<HashMap<String, Box<dyn ProviderAdapter>>>>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self {
            adapters: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register an adapter
    pub async fn register(&self, adapter: Box<dyn ProviderAdapter>) {
        let provider_id = adapter.provider_id().to_string();
        info!("Registered adapter for provider: {} ({})", provider_id, adapter.display_name());
        self.adapters.write().await.insert(provider_id, adapter);
    }

    /// Get adapter by provider ID
    pub async fn get_adapter(&self, provider_id: &str) -> Option<Arc<dyn ProviderAdapter>> {
        let adapters = self.adapters.read().await;
        adapters.get(provider_id).map(|a| Arc::clone(a))
    }

    /// List all registered provider IDs
    pub async fn list_providers(&self) -> Vec<String> {
        let adapters = self.adapters.read().await;
        adapters.keys().cloned().collect()
    }

    /// Check if provider is registered
    pub async fn has_provider(&self, provider_id: &str) -> bool {
        let adapters = self.adapters.read().await;
        adapters.contains_key(provider_id)
    }

    /// Get number of registered adapters
    pub async fn adapter_count(&self) -> usize {
        let adapters = self.adapters.read().await;
        adapters.len()
    }
}
