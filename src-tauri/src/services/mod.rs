//! Background services
//!
//! Rust async equivalents of the 60+ Electron main process services.

pub mod database;
pub mod migrations;
mod migrations_additional;
pub mod session_manager;
pub mod adapter_registry;
pub mod agent_bridge;
pub mod provider_health;
pub mod cost;
pub mod checkpoint;
pub mod file_change_tracker;
pub mod memory_coordinator;
pub mod concurrency;
pub mod notification;
pub mod team;
pub mod scheduler;
pub mod workflow;
pub mod goal;
pub mod drift_guard;
pub mod cross_memory;
pub mod working_context;
pub mod session_template;
pub mod code_context;
pub mod code_graph;
pub mod knowledge;
pub mod code_review;
pub mod replay;
pub mod context_budget;
pub mod battle;
pub mod daily_report;
pub mod skill_arena;
pub mod voice;
pub mod community;
pub mod telegram;
pub mod feishu;
pub mod prompt_optimizer;
pub mod memory_dedup;
pub mod cost_optimization;
pub mod planner;
pub mod summary;
pub mod evaluation;
pub mod reference_project;
pub mod mcp;
pub mod pty;
pub mod reference;
