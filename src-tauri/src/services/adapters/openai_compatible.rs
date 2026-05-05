//! OpenAI Compatible Adapter - HTTP API based adapter
//!
//! Phase 4: Support OpenAI-compatible API providers.
//! Supports: Deepseek, Qwen, GLM, Moonshot, Ollama, vLLM, LocalAI, etc.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

/// Chat message role
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

/// Chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
}

/// Stream options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamOptions {
    pub include_usage: bool,
}

/// Chat completion request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<StreamOptions>,
}

/// Usage statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// Delta content for streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<MessageRole>,
}

/// Choice in streaming response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub index: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<Delta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

/// Streaming response chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<Choice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
}

/// Session configuration
#[derive(Debug, Clone)]
pub struct OpenAICompatibleConfig {
    pub base_url: String,
    pub api_key: String,
    pub default_model: String,
    pub timeout_ms: u64,
    pub max_tokens: u32,
    pub temperature: f32,
    pub extra_headers: HashMap<String, String>,
}

/// Session state
#[derive(Debug, Clone)]
pub struct SessionState {
    pub session_id: String,
    pub messages: Vec<ChatMessage>,
    pub is_streaming: bool,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// OpenAI Compatible Adapter
pub struct OpenAICompatibleAdapter {
    /// HTTP client
    client: Client,
    /// Active sessions
    sessions: Arc<RwLock<HashMap<String, SessionState>>>,
    /// Default configuration
    config: OpenAICompatibleConfig,
}

impl OpenAICompatibleAdapter {
    /// Create a new adapter with configuration
    pub fn new(config: OpenAICompatibleConfig) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_millis(config.timeout_ms))
            .build()?;

        info!(
            "OpenAI Compatible Adapter initialized for {}",
            config.base_url
        );

        Ok(Self {
            client,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            config,
        })
    }

    /// Start a new session
    pub async fn start_session(
        &self,
        session_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let session = SessionState {
            session_id: session_id.to_string(),
            messages: Vec::new(),
            is_streaming: false,
            input_tokens: 0,
            output_tokens: 0,
        };

        self.sessions.write().await.insert(session_id.to_string(), session);
        info!("Started session {}", session_id);

        Ok(())
    }

    /// Send a message and receive streaming response
    pub async fn send_message(
        &self,
        session_id: &str,
        user_message: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;

        // Add user message
        session.messages.push(ChatMessage {
            role: MessageRole::User,
            content: user_message.to_string(),
        });

        session.is_streaming = true;
        drop(sessions);

        // Build request
        let request = ChatCompletionRequest {
            model: self.config.default_model.clone(),
            messages: self.get_session_messages(session_id).await?,
            max_tokens: Some(self.config.max_tokens),
            temperature: Some(self.config.temperature),
            stream: true,
            stream_options: Some(StreamOptions {
                include_usage: true,
            }),
        };

        // Send request
        let url = format!("{}/chat/completions", self.config.base_url.trim_end_matches('/'));
        
        let mut req_builder = self.client.post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.config.api_key));

        // Add extra headers
        for (key, value) in &self.config.extra_headers {
            req_builder = req_builder.header(key, value);
        }

        let response = req_builder
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(format!("API Error: {}", error_text).into());
        }

        // Process streaming response
        let mut stream = response.bytes_stream();
        let mut full_content = String::new();
        let mut buffer = String::new();

        use futures_util::StreamExt;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process lines
            let lines: Vec<&str> = buffer.split('\n').collect();
            buffer = lines.last().unwrap_or(&"").to_string();

            for line in &lines[..lines.len() - 1] {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed == "data: [DONE]" {
                    continue;
                }

                if let Some(data) = trimmed.strip_prefix("data: ") {
                    if let Ok(chunk_data) = serde_json::from_str::<ChatCompletionChunk>(data) {
                        // Extract content from delta
                        if let Some(choices) = chunk_data.choices.first() {
                            if let Some(delta) = &choices.delta {
                                if let Some(content) = &delta.content {
                                    full_content.push_str(content);
                                    
                                    // TODO: Emit text_chunk event to frontend
                                    debug!("Received chunk: {}", content);
                                }
                            }
                        }

                        // Update token usage
                        if let Some(usage) = chunk_data.usage {
                            let mut sessions = self.sessions.write().await;
                            if let Some(session) = sessions.get_mut(session_id) {
                                session.input_tokens = usage.prompt_tokens;
                                session.output_tokens = usage.completion_tokens;
                            }
                        }
                    }
                }
            }
        }

        // Add assistant message
        if !full_content.is_empty() {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.get_mut(session_id) {
                session.messages.push(ChatMessage {
                    role: MessageRole::Assistant,
                    content: full_content.clone(),
                });
                session.is_streaming = false;
            }
        }

        info!("Completed message for session {}", session_id);
        Ok(())
    }

    /// Get session messages
    async fn get_session_messages(&self, session_id: &str) -> Result<Vec<ChatMessage>, String> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        
        Ok(session.messages.clone())
    }

    /// Abort current turn
    pub async fn abort_turn(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.is_streaming = false;
        }
        Ok(())
    }

    /// Terminate session
    pub async fn terminate_session(&self, session_id: &str) -> Result<(), String> {
        self.sessions.write().await.remove(session_id);
        info!("Terminated session {}", session_id);
        Ok(())
    }

    /// Get conversation history
    pub async fn get_conversation(&self, session_id: &str) -> Result<Vec<ChatMessage>, String> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        
        Ok(session.messages.clone())
    }

    /// Check if session exists
    pub async fn has_session(&self, session_id: &str) -> bool {
        self.sessions.read().await.contains_key(session_id)
    }

    /// Get token usage
    pub async fn get_usage(&self, session_id: &str) -> Result<(u32, u32), String> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        
        Ok((session.input_tokens, session.output_tokens))
    }
}
