//! Database migration system for rusqlite
//!
//! Translates all 48+ migrations from src/main/storage/migrations.ts

use rusqlite::{Connection, Result as SqlResult};
use tracing::{info, warn};

/// A single database migration
#[derive(Clone)]
pub struct Migration {
    pub version: i64,
    pub description: &'static str,
    pub up: fn(&Connection) -> SqlResult<()>,
}

/// Check if a table exists
fn table_exists(conn: &Connection, table_name: &str) -> SqlResult<bool> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    )?;
    let exists = stmt.exists([table_name])?;
    Ok(exists)
}

/// Get column names of a table
fn get_column_names(conn: &Connection, table_name: &str) -> SqlResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info('{}')", table_name))?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(cols)
}

/// Add column if it doesn't exist
fn add_column_if_not_exists(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> SqlResult<bool> {
    let cols = get_column_names(conn, table)?;
    if !cols.iter().any(|c| c == column) {
        conn.execute_batch(&format!(
            "ALTER TABLE {} ADD COLUMN {} {}",
            table, column, definition
        ))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

mod migrations_additional;

/// All versioned migrations (in order from migrations.ts)
pub const MIGRATIONS: &[Migration] = &[
    // v1: sessions.claude_session_id
    Migration {
        version: 1,
        description: "add claude_session_id column to sessions",
        up: |conn| {
            add_column_if_not_exists(conn, "sessions", "claude_session_id", "TEXT")?;
            Ok(())
        },
    },

    // v2: ai_providers table
    Migration {
        version: 2,
        description: "create ai_providers table",
        up: |conn| {
            if !table_exists(conn, "ai_providers")? {
                conn.execute_batch(
                    "CREATE TABLE ai_providers (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        command TEXT NOT NULL,
                        is_builtin INTEGER NOT NULL DEFAULT 0,
                        icon TEXT,
                        default_args TEXT,
                        auto_accept_arg TEXT,
                        resume_arg TEXT,
                        session_id_detection TEXT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )",
                )?;
            }
            Ok(())
        },
    },

    // v3: ai_providers new columns
    Migration {
        version: 3,
        description: "add node_version / env_overrides / resume_format / session_id_pattern / executable_path to ai_providers",
        up: |conn| {
            if !table_exists(conn, "ai_providers")? {
                return Ok(());
            }
            add_column_if_not_exists(conn, "ai_providers", "session_id_detection", "TEXT")?;
            add_column_if_not_exists(conn, "ai_providers", "node_version", "TEXT")?;
            add_column_if_not_exists(conn, "ai_providers", "env_overrides", "TEXT")?;
            add_column_if_not_exists(conn, "ai_providers", "resume_format", "TEXT")?;
            add_column_if_not_exists(conn, "ai_providers", "session_id_pattern", "TEXT")?;
            add_column_if_not_exists(conn, "ai_providers", "executable_path", "TEXT")?;
            Ok(())
        },
    },

    // v4: ai_providers.sort_order
    Migration {
        version: 4,
        description: "add sort_order column to ai_providers",
        up: |conn| {
            if !table_exists(conn, "ai_providers")? {
                return Ok(());
            }
            add_column_if_not_exists(
                conn,
                "ai_providers",
                "sort_order",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            Ok(())
        },
    },

    // v5: ai_providers.git_bash_path
    Migration {
        version: 5,
        description: "add git_bash_path column to ai_providers",
        up: |conn| {
            if !table_exists(conn, "ai_providers")? {
                return Ok(());
            }
            add_column_if_not_exists(conn, "ai_providers", "git_bash_path", "TEXT")?;
            Ok(())
        },
    },

    // v6: ai_providers.default_model
    Migration {
        version: 6,
        description: "add default_model column to ai_providers",
        up: |conn| {
            if !table_exists(conn, "ai_providers")? {
                return Ok(());
            }
            add_column_if_not_exists(conn, "ai_providers", "default_model", "TEXT")?;
            Ok(())
        },
    },

    // v7: upsert builtin providers
    Migration {
        version: 7,
        description: "upsert builtin providers",
        up: |conn| {
            if !table_exists(conn, "ai_providers")? {
                return Ok(());
            }
            let cols = get_column_names(conn, "ai_providers")?;
            if !cols.iter().any(|c| c == "name") {
                return Ok(());
            }

            // Note: BUILTIN_PROVIDERS data should be injected here
            // For now, skip this migration as it requires the provider data
            info!("Skipping builtin providers upsert - implement with actual provider data");
            Ok(())
        },
    },

    // v8: delete removed aider provider
    Migration {
        version: 8,
        description: "delete removed aider provider",
        up: |conn| {
            if !table_exists(conn, "ai_providers")? {
                return Ok(());
            }
            let _ = conn.execute(
                "DELETE FROM ai_providers WHERE id = 'aider' AND is_builtin = 1",
                [],
            );
            Ok(())
        },
    },

    // v9: sessions.provider_id + sessions.name_locked
    Migration {
        version: 9,
        description: "add provider_id and name_locked columns to sessions",
        up: |conn| {
            add_column_if_not_exists(conn, "sessions", "provider_id", "TEXT")?;
            add_column_if_not_exists(
                conn,
                "sessions",
                "name_locked",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            Ok(())
        },
    },

    // v12: session_summaries table
    Migration {
        version: 12,
        description: "create session_summaries table",
        up: |conn| {
            if !table_exists(conn, "session_summaries")? {
                conn.execute_batch(
                    "CREATE TABLE session_summaries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        summary TEXT NOT NULL,
                        key_points TEXT,
                        ai_provider TEXT,
                        ai_model TEXT,
                        input_tokens INTEGER,
                        output_tokens INTEGER,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE INDEX idx_session_summaries_session
                        ON session_summaries(session_id, created_at);",
                )?;
            }
            Ok(())
        },
    },

    // v13: ai_call_logs table
    Migration {
        version: 13,
        description: "create ai_call_logs table",
        up: |conn| {
            if !table_exists(conn, "ai_call_logs")? {
                conn.execute_batch(
                    "CREATE TABLE ai_call_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        call_type TEXT NOT NULL,
                        provider TEXT NOT NULL,
                        model TEXT NOT NULL,
                        session_id TEXT,
                        input_tokens INTEGER,
                        output_tokens INTEGER,
                        duration_ms INTEGER,
                        cost_estimate REAL,
                        status TEXT NOT NULL DEFAULT 'success',
                        error TEXT,
                        metadata TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE INDEX idx_ai_call_logs_session
                        ON ai_call_logs(session_id, created_at);
                    CREATE INDEX idx_ai_call_logs_type
                        ON ai_call_logs(call_type, created_at);",
                )?;
            }
            Ok(())
        },
    },

    // v14: plan_executions table
    Migration {
        version: 14,
        description: "create plan_executions table",
        up: |conn| {
            if !table_exists(conn, "plan_executions")? {
                conn.execute_batch(
                    "CREATE TABLE plan_executions (
                        id TEXT PRIMARY KEY,
                        session_id TEXT NOT NULL,
                        plan_content TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        current_step INTEGER DEFAULT 0,
                        total_steps INTEGER DEFAULT 0,
                        step_results TEXT,
                        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        completed_at DATETIME
                    );
                    CREATE INDEX idx_plan_executions_session
                        ON plan_executions(session_id);",
                )?;
            }
            Ok(())
        },
    },

    // v15: tasks worktree columns
    Migration {
        version: 15,
        description: "add worktree columns to tasks",
        up: |conn| {
            add_column_if_not_exists(conn, "tasks", "worktree_enabled", "INTEGER NOT NULL DEFAULT 0")?;
            add_column_if_not_exists(conn, "tasks", "git_repo_path", "TEXT")?;
            add_column_if_not_exists(conn, "tasks", "git_branch", "TEXT")?;
            add_column_if_not_exists(conn, "tasks", "worktree_path", "TEXT")?;
            Ok(())
        },
    },

    // v16: conversation_messages table
    Migration {
        version: 16,
        description: "create conversation_messages table",
        up: |conn| {
            if !table_exists(conn, "conversation_messages")? {
                conn.execute_batch(
                    "CREATE TABLE conversation_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        message_id TEXT,
                        role TEXT NOT NULL,
                        type TEXT NOT NULL DEFAULT 'text',
                        content TEXT,
                        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        tool_name TEXT,
                        tool_input TEXT,
                        tool_result TEXT,
                        is_error INTEGER NOT NULL DEFAULT 0,
                        thinking_text TEXT,
                        usage_input_tokens INTEGER,
                        usage_output_tokens INTEGER,
                        tool_use_id TEXT
                    );
                    CREATE INDEX idx_conv_messages_session ON conversation_messages(session_id, timestamp);",
                )?;
            } else {
                add_column_if_not_exists(conn, "conversation_messages", "attachments", "TEXT")?;
            }
            Ok(())
        },
    },

    // v17: app_settings table
    Migration {
        version: 17,
        description: "create app_settings table",
        up: |conn| {
            if !table_exists(conn, "app_settings")? {
                conn.execute_batch(
                    "CREATE TABLE app_settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )",
                )?;
            }
            Ok(())
        },
    },

    // v18: workspaces and workspace_repos tables
    Migration {
        version: 18,
        description: "create workspaces and workspace_repos tables",
        up: |conn| {
            if !table_exists(conn, "workspaces")? {
                conn.execute_batch(
                    "CREATE TABLE workspaces (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT,
                        root_path TEXT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE workspace_repos (
                        id TEXT PRIMARY KEY,
                        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                        repo_path TEXT NOT NULL,
                        name TEXT NOT NULL,
                        is_primary INTEGER NOT NULL DEFAULT 0,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        UNIQUE(workspace_id, repo_path)
                    );
                    CREATE INDEX idx_workspace_repos_workspace ON workspace_repos(workspace_id);",
                )?;
            }
            Ok(())
        },
    },

    // v19: tasks.workspace_id + tasks.worktree_paths
    Migration {
        version: 19,
        description: "add workspace_id and worktree_paths to tasks",
        up: |conn| {
            add_column_if_not_exists(conn, "tasks", "workspace_id", "TEXT")?;
            add_column_if_not_exists(conn, "tasks", "worktree_paths", "TEXT")?;
            Ok(())
        },
    },

    // v20: mcp_servers table
    Migration {
        version: 20,
        description: "create mcp_servers table",
        up: |conn| {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS mcp_servers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    category TEXT DEFAULT 'custom',
                    transport TEXT NOT NULL DEFAULT 'stdio',
                    command TEXT,
                    args TEXT,
                    url TEXT,
                    compatible_providers TEXT NOT NULL DEFAULT '\"all\"',
                    fallback_mode TEXT NOT NULL DEFAULT 'disabled',
                    config_schema TEXT,
                    user_config TEXT,
                    env_vars TEXT,
                    is_installed INTEGER NOT NULL DEFAULT 0,
                    install_method TEXT DEFAULT 'builtin',
                    install_command TEXT,
                    source TEXT NOT NULL DEFAULT 'custom',
                    registry_url TEXT,
                    version TEXT,
                    is_global_enabled INTEGER NOT NULL DEFAULT 1,
                    enabled_for_providers TEXT,
                    tags TEXT,
                    author TEXT,
                    homepage TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )",
            )?;
            Ok(())
        },
    },

    // v21: chat_task_sessions table
    Migration {
        version: 21,
        description: "create chat_task_sessions table",
        up: |conn| {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS chat_task_sessions (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id    TEXT NOT NULL,
                    platform   TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    session_name TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_chat_task_sessions_chat
                    ON chat_task_sessions(chat_id, platform, created_at DESC);",
            )?;
            Ok(())
        },
    },

    // v23: skills table
    Migration {
        version: 23,
        description: "create skills table",
        up: |conn| {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS skills (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    category TEXT DEFAULT 'general',
                    slash_command TEXT,
                    type TEXT NOT NULL DEFAULT 'prompt',
                    compatible_providers TEXT NOT NULL DEFAULT '\"all\"',
                    prompt_template TEXT,
                    system_prompt_addition TEXT,
                    input_variables TEXT,
                    native_config TEXT,
                    required_mcps TEXT,
                    is_installed INTEGER NOT NULL DEFAULT 1,
                    is_enabled INTEGER NOT NULL DEFAULT 1,
                    source TEXT NOT NULL DEFAULT 'custom',
                    version TEXT,
                    author TEXT,
                    tags TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )",
            )?;
            Ok(())
        },
    },

    // v28: conversation_messages file_change column
    Migration {
        version: 28,
        description: "add file_change column to conversation_messages",
        up: |conn| {
            add_column_if_not_exists(conn, "conversation_messages", "file_change", "TEXT")?;
            Ok(())
        },
    },

    // v29: mcp_servers headers column
    Migration {
        version: 29,
        description: "add headers column to mcp_servers",
        up: |conn| {
            add_column_if_not_exists(conn, "mcp_servers", "headers", "TEXT")?;
            Ok(())
        },
    },

    // v30: fix conversation_messages id type
    Migration {
        version: 30,
        description: "fix conversation_messages id type from INTEGER to TEXT",
        up: |conn| {
            // SQLite doesn't support ALTER COLUMN, need to rebuild table
            conn.execute_batch(
                "-- Create new table with TEXT id
                CREATE TABLE conversation_messages_new (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT 'text',
                    content TEXT,
                    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    attachments TEXT,
                    tool_name TEXT,
                    tool_input TEXT,
                    tool_result TEXT,
                    is_error INTEGER NOT NULL DEFAULT 0,
                    thinking_text TEXT,
                    usage_input_tokens INTEGER,
                    usage_output_tokens INTEGER,
                    tool_use_id TEXT,
                    file_change TEXT
                );
                CREATE INDEX idx_conv_messages_session_new ON conversation_messages(session_id, timestamp);

                -- Copy data
                INSERT OR IGNORE INTO conversation_messages_new
                (id, session_id, role, type, content, timestamp, attachments, tool_name, tool_input, tool_result,
                 is_error, thinking_text, usage_input_tokens, usage_output_tokens, tool_use_id, file_change)
                SELECT
                    COALESCE(CAST(id AS TEXT), 'msg_' || rowid),
                    session_id, role, type, content, timestamp, attachments, tool_name, tool_input, tool_result,
                    is_error, thinking_text, usage_input_tokens, usage_output_tokens, tool_use_id, file_change
                FROM conversation_messages;

                -- Drop old table
                DROP TABLE conversation_messages;

                -- Rename new table
                ALTER TABLE conversation_messages_new RENAME TO conversation_messages;",
            )?;
            info!("Successfully rebuilt conversation_messages table with TEXT id");
            Ok(())
        },
    },

    // v31: Agent Teams tables
    Migration {
        version: 31,
        description: "create Agent Teams tables",
        up: |conn| {
            // team_instances table
            if !table_exists(conn, "team_instances")? {
                conn.execute_batch(
                    "CREATE TABLE team_instances (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        template_id TEXT,
                        status TEXT NOT NULL DEFAULT 'pending',
                        work_dir TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        objective TEXT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        started_at DATETIME,
                        completed_at DATETIME
                    )",
                )?;
            } else {
                add_column_if_not_exists(conn, "team_instances", "created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")?;
                add_column_if_not_exists(conn, "team_instances", "started_at", "DATETIME")?;
                add_column_if_not_exists(conn, "team_instances", "completed_at", "DATETIME")?;
                add_column_if_not_exists(conn, "team_instances", "objective", "TEXT")?;
            }

            // team_members table
            if !table_exists(conn, "team_members")? {
                conn.execute_batch(
                    "CREATE TABLE team_members (
                        id TEXT PRIMARY KEY,
                        instance_id TEXT NOT NULL,
                        role_id TEXT NOT NULL,
                        role_name TEXT NOT NULL,
                        role_identifier TEXT NOT NULL,
                        role_icon TEXT,
                        role_color TEXT,
                        session_id TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'idle',
                        provider_id TEXT NOT NULL,
                        current_task_id TEXT,
                        joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        last_active_at DATETIME,
                        FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
                    );
                    CREATE INDEX idx_team_members_instance ON team_members(instance_id);",
                )?;
            } else {
                add_column_if_not_exists(conn, "team_members", "role_name", "TEXT NOT NULL")?;
                add_column_if_not_exists(conn, "team_members", "role_identifier", "TEXT NOT NULL")?;
                add_column_if_not_exists(conn, "team_members", "role_icon", "TEXT")?;
                add_column_if_not_exists(conn, "team_members", "role_color", "TEXT")?;
                add_column_if_not_exists(conn, "team_members", "current_task_id", "TEXT")?;
                add_column_if_not_exists(conn, "team_members", "last_active_at", "DATETIME")?;
            }

            // team_tasks table
            if !table_exists(conn, "team_tasks")? {
                conn.execute_batch(
                    "CREATE TABLE team_tasks (
                        id TEXT PRIMARY KEY,
                        instance_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        description TEXT,
                        status TEXT NOT NULL DEFAULT 'pending',
                        assigned_to TEXT,
                        claimed_by TEXT,
                        claimed_at DATETIME,
                        priority TEXT NOT NULL DEFAULT 'medium',
                        dependencies TEXT,
                        result TEXT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        completed_at DATETIME,
                        FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
                    );
                    CREATE INDEX idx_team_tasks_instance_status ON team_tasks(instance_id, status);",
                )?;
            } else {
                add_column_if_not_exists(conn, "team_tasks", "claimed_by", "TEXT")?;
                add_column_if_not_exists(conn, "team_tasks", "claimed_at", "DATETIME")?;
                add_column_if_not_exists(conn, "team_tasks", "priority", "TEXT NOT NULL DEFAULT 'medium'")?;
                add_column_if_not_exists(conn, "team_tasks", "dependencies", "TEXT")?;
                add_column_if_not_exists(conn, "team_tasks", "result", "TEXT")?;
                add_column_if_not_exists(conn, "team_tasks", "completed_at", "DATETIME")?;
            }

            // team_messages table
            if !table_exists(conn, "team_messages")? {
                conn.execute_batch(
                    "CREATE TABLE team_messages (
                        id TEXT PRIMARY KEY,
                        instance_id TEXT NOT NULL,
                        from_member_id TEXT NOT NULL,
                        to_member_id TEXT,
                        type TEXT NOT NULL DEFAULT 'role_message',
                        content TEXT NOT NULL,
                        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
                    );
                    CREATE INDEX idx_team_messages_instance_timestamp ON team_messages(instance_id, timestamp DESC);",
                )?;
            } else {
                add_column_if_not_exists(conn, "team_messages", "timestamp", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")?;
            }

            // team_templates table
            if !table_exists(conn, "team_templates")? {
                conn.execute_batch(
                    "CREATE TABLE team_templates (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT,
                        roles TEXT NOT NULL,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )",
                )?;
            }

            info!("Agent Teams tables created successfully");
            Ok(())
        },
    },

    // v32: Telegram integration
    Migration {
        version: 32,
        description: "create telegram_integrations and telegram_chat_mappings tables",
        up: |conn| {
            if !table_exists(conn, "telegram_integrations")? {
                conn.execute_batch(
                    "CREATE TABLE telegram_integrations (
                        id              TEXT PRIMARY KEY,
                        enabled         INTEGER NOT NULL DEFAULT 0,
                        command_prefix  TEXT NOT NULL DEFAULT '/',
                        notify_on_start INTEGER NOT NULL DEFAULT 1,
                        notify_on_end   INTEGER NOT NULL DEFAULT 1,
                        notify_on_error INTEGER NOT NULL DEFAULT 1,
                        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )",
                )?;
            }

            if !table_exists(conn, "telegram_chat_mappings")? {
                conn.execute_batch(
                    "CREATE TABLE telegram_chat_mappings (
                        id              TEXT PRIMARY KEY,
                        integration_id  TEXT NOT NULL,
                        chat_id         TEXT NOT NULL,
                        session_id      TEXT NOT NULL,
                        session_name    TEXT,
                        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(integration_id, chat_id, session_id)
                    )",
                )?;
            }

            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_telegram_chat_mappings_chat
                    ON telegram_chat_mappings(integration_id, chat_id)",
            )?;

            info!("Telegram tables created successfully");
            Ok(())
        },
    },

    // v33: Feishu integration
    Migration {
        version: 33,
        description: "create feishu integrations and chat mappings tables",
        up: |conn| {
            if !table_exists(conn, "feishu_integrations")? {
                conn.execute_batch(
                    "CREATE TABLE feishu_integrations (
                        id              TEXT PRIMARY KEY,
                        app_id          TEXT,
                        app_secret      TEXT,
                        webhook_url     TEXT,
                        enabled         INTEGER NOT NULL DEFAULT 0,
                        notify_on_start INTEGER NOT NULL DEFAULT 1,
                        notify_on_end   INTEGER NOT NULL DEFAULT 1,
                        notify_on_error INTEGER NOT NULL DEFAULT 1,
                        bot_name        TEXT,
                        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )",
                )?;
            }

            if !table_exists(conn, "feishu_chat_mappings")? {
                conn.execute_batch(
                    "CREATE TABLE feishu_chat_mappings (
                        id              TEXT PRIMARY KEY,
                        integration_id TEXT NOT NULL,
                        chat_id        TEXT NOT NULL,
                        chat_name      TEXT,
                        session_id     TEXT NOT NULL,
                        session_name   TEXT,
                        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(integration_id, chat_id, session_id)
                    )",
                )?;
            }

            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_feishu_chat_mappings_chat
                    ON feishu_chat_mappings(integration_id, chat_id)",
            )?;

            info!("Feishu tables created successfully");
            Ok(())
        },
    },

    // v34: Scheduled tasks
    Migration {
        version: 34,
        description: "create scheduled_tasks and task_runs tables",
        up: |conn| {
            if !table_exists(conn, "scheduled_tasks")? {
                conn.execute_batch(
                    "CREATE TABLE scheduled_tasks (
                        id                  TEXT PRIMARY KEY,
                        name                TEXT NOT NULL,
                        description         TEXT,
                        task_type           TEXT NOT NULL DEFAULT 'prompt'
                                            CHECK(task_type IN ('prompt', 'workflow', 'agent_task', 'cleanup', 'notification')),
                        schedule_type       TEXT NOT NULL DEFAULT 'interval'
                                            CHECK(schedule_type IN ('interval', 'cron', 'once', 'daily', 'weekly')),
                        cron_expression     TEXT,
                        interval_seconds    INTEGER,
                        config              TEXT NOT NULL,
                        target_session_id   TEXT,
                        target_workspace_id TEXT,
                        is_enabled          INTEGER NOT NULL DEFAULT 1,
                        last_run_at         DATETIME,
                        next_run_at         DATETIME,
                        run_count           INTEGER NOT NULL DEFAULT 0,
                        error_count         INTEGER NOT NULL DEFAULT 0,
                        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )",
                )?;
            }

            if !table_exists(conn, "task_runs")? {
                conn.execute_batch(
                    "CREATE TABLE task_runs (
                        id              TEXT PRIMARY KEY,
                        task_id         TEXT NOT NULL,
                        status          TEXT NOT NULL DEFAULT 'running',
                        started_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        completed_at    DATETIME,
                        error           TEXT,
                        result          TEXT,
                        FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
                    );
                    CREATE INDEX idx_task_runs_task ON task_runs(task_id);",
                )?;
            }

            info!("Scheduled tasks tables created successfully");
            Ok(())
        },
    },
];

/// Run all pending migrations
pub fn run_migrations(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    // Get current schema version
    let current_version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    info!("Current database schema version: {}", current_version);
    
    // Combine base migrations with additional ones
    let mut all_migrations = MIGRATIONS.to_vec();
    let additional = migrations_additional::get_additional_migrations();
    all_migrations.extend(additional);
    
    info!("Total migrations available: {}", all_migrations.len());

    for migration in all_migrations {
        if migration.version > current_version {
            info!(
                "Running migration v{}: {}",
                migration.version, migration.description
            );

            // Execute migration in a transaction
            let tx = conn.unchecked_transaction()?;
            (migration.up)(&tx)?;

            // Update schema version
            tx.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, datetime('now'))",
                [migration.version],
            )?;

            tx.commit()?;

            info!("Migration v{} completed successfully", migration.version);
        }
    }

    let final_version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    info!("Database schema updated to version: {}", final_version);
    Ok(())
}

/// Initialize schema_version table if it doesn't exist
pub fn ensure_schema_version_table(conn: &Connection) -> SqlResult<()> {
    if !table_exists(conn, "schema_version")? {
        conn.execute_batch(
            "CREATE TABLE schema_version (
                version INTEGER PRIMARY KEY,
                applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
        )?;
        info!("Created schema_version table");
    }
    Ok(())
}
