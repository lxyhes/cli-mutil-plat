//! PrismOps - Tauri + Rust Main Process Library
//!
//! This is the Rust rewrite of the Electron main process.
//! Architecture: Tauri app with Rust backend + Node.js sidecar for Claude SDK.

pub mod commands;
pub mod services;
pub mod types;
