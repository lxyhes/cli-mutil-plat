//! Cost and billing type definitions

use serde::{Deserialize, Serialize};

/// Cost record for a provider call
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostRecord {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost: f64,
    pub currency: String,
    pub timestamp: i64,
}

/// Budget configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetConfig {
    pub enabled: bool,
    pub limit: f64,
    pub period: String,
    pub spent: f64,
}
