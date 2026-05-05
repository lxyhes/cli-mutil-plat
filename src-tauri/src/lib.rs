//! PrismOps - Tauri + Rust Main Process Library
//!
//! This is the Rust rewrite of the Electron main process.
//! Architecture: Tauri app with Rust backend + Node.js sidecar for Claude SDK.

mod commands;
mod services;
mod types;

pub use commands::*;
pub use services::*;
pub use types::*;
