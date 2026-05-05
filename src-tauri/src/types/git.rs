//! Git type definitions

use serde::{Deserialize, Serialize};

/// Git status for a file or directory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub path: String,
    pub staged: bool,
    pub modified: bool,
    pub untracked: bool,
    pub deleted: bool,
}

/// Git branch info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub commit: Option<String>,
}
