//! Team type definitions

use serde::{Deserialize, Serialize};

/// Team member info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub id: String,
    pub name: String,
    pub role: String,
    pub provider: String,
    pub active: bool,
}

/// Team session info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSession {
    pub id: String,
    pub name: String,
    pub members: Vec<TeamMember>,
    pub status: String,
}
