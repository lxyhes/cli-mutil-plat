//! Additional migrations v35-v48
//! 
//! This file contains the remaining migrations that were not in the initial batch.

use rusqlite::{Connection, Result as SqlResult};
use tracing::info;

use super::{table_exists, add_column_if_not_exists, Migration};

pub fn get_additional_migrations() -> Vec<Migration> {
    vec![
        // v35: Planner engine
        Migration {
            version: 35,
            description: "create plan_sessions, plan_tasks, plan_steps tables",
            up: |conn| {
                if !table_exists(conn, "plan_sessions")? {
                    conn.execute_batch(
                        "CREATE TABLE plan_sessions (
                            id          TEXT PRIMARY KEY,
                            session_id  TEXT NOT NULL,
                            goal        TEXT NOT NULL,
                            status      TEXT NOT NULL DEFAULT 'pending'
                                        CHECK(status IN ('pending', 'running', 'completed', 'failed')),
                            created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            started_at  DATETIME,
                            completed_at DATETIME
                        )",
                    )?;
                }

                if !table_exists(conn, "plan_tasks")? {
                    conn.execute_batch(
                        "CREATE TABLE plan_tasks (
                            id              TEXT PRIMARY KEY,
                            plan_session_id TEXT NOT NULL,
                            title           TEXT NOT NULL,
                            description     TEXT,
                            priority        TEXT NOT NULL DEFAULT 'medium'
                                            CHECK(priority IN ('low', 'medium', 'high', 'critical')),
                            status          TEXT NOT NULL DEFAULT 'pending'
                                            CHECK(status IN ('pending', 'in_progress', 'completed', 'skipped')),
                            dependencies    TEXT,
                            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            completed_at    DATETIME,
                            FOREIGN KEY (plan_session_id) REFERENCES plan_sessions(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_plan_tasks_session ON plan_tasks(plan_session_id, status);",
                    )?;
                }

                if !table_exists(conn, "plan_steps")? {
                    conn.execute_batch(
                        "CREATE TABLE plan_steps (
                            id           TEXT PRIMARY KEY,
                            plan_task_id TEXT NOT NULL,
                            description  TEXT NOT NULL,
                            status       TEXT NOT NULL DEFAULT 'pending'
                                         CHECK(status IN ('pending', 'running', 'completed', 'skipped', 'failed')),
                            result       TEXT,
                            order_index  INTEGER NOT NULL DEFAULT 0,
                            created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            completed_at DATETIME,
                            FOREIGN KEY (plan_task_id) REFERENCES plan_tasks(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_plan_steps_task ON plan_steps(plan_task_id, order_index);",
                    )?;
                }

                info!("Planner tables created successfully");
                Ok(())
            },
        },

        // v37: Workflow orchestration
        Migration {
            version: 37,
            description: "create workflows, workflow_executions, workflow_runs tables",
            up: |conn| {
                if !table_exists(conn, "workflows")? {
                    conn.execute_batch(
                        "CREATE TABLE workflows (
                            id          TEXT PRIMARY KEY,
                            name        TEXT NOT NULL,
                            description TEXT,
                            steps       TEXT NOT NULL,
                            variables   TEXT NOT NULL DEFAULT '{}',
                            status      TEXT NOT NULL DEFAULT 'draft'
                                        CHECK(status IN ('draft', 'running', 'paused')),
                            created_by  TEXT,
                            created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        )",
                    )?;
                }

                if !table_exists(conn, "workflow_executions")? {
                    conn.execute_batch(
                        "CREATE TABLE workflow_executions (
                            id           TEXT PRIMARY KEY,
                            workflow_id  TEXT NOT NULL,
                            status       TEXT NOT NULL DEFAULT 'pending'
                                        CHECK(status IN ('pending', 'running', 'completed', 'failed', 'paused')),
                            started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            completed_at DATETIME,
                            triggered_by TEXT NOT NULL DEFAULT 'manual'
                                        CHECK(triggered_by IN ('manual', 'scheduled', 'event')),
                            context      TEXT NOT NULL DEFAULT '{}',
                            result       TEXT,
                            error        TEXT,
                            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
                        )",
                    )?;
                }

                if !table_exists(conn, "workflow_runs")? {
                    conn.execute_batch(
                        "CREATE TABLE workflow_runs (
                            id           TEXT PRIMARY KEY,
                            execution_id TEXT NOT NULL,
                            step_id      TEXT NOT NULL,
                            step_order   INTEGER NOT NULL,
                            status       TEXT NOT NULL DEFAULT 'pending'
                                        CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
                            started_at   DATETIME,
                            completed_at DATETIME,
                            input        TEXT NOT NULL DEFAULT '{}',
                            output       TEXT,
                            error        TEXT,
                            retries      INTEGER NOT NULL DEFAULT 0,
                            FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id, started_at DESC);
                        CREATE INDEX idx_workflow_runs_execution ON workflow_runs(execution_id, step_order);",
                    )?;
                }

                info!("Workflow tables created successfully");
                Ok(())
            },
        },

        // v38: Task evaluation
        Migration {
            version: 38,
            description: "create evaluation_templates, evaluation_runs, evaluation_results tables",
            up: |conn| {
                if !table_exists(conn, "evaluation_templates")? {
                    conn.execute_batch(
                        "CREATE TABLE evaluation_templates (
                            id              TEXT PRIMARY KEY,
                            name            TEXT NOT NULL,
                            description     TEXT,
                            criteria        TEXT NOT NULL,
                            prompt_template TEXT NOT NULL,
                            created_by      TEXT,
                            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        )",
                    )?;
                }

                if !table_exists(conn, "evaluation_runs")? {
                    conn.execute_batch(
                        "CREATE TABLE evaluation_runs (
                            id                  TEXT PRIMARY KEY,
                            template_id         TEXT NOT NULL,
                            session_id          TEXT NOT NULL,
                            status              TEXT NOT NULL DEFAULT 'pending'
                                                CHECK(status IN ('pending', 'running', 'completed', 'failed')),
                            trigger_type        TEXT NOT NULL DEFAULT 'manual'
                                                CHECK(trigger_type IN ('manual', 'scheduled')),
                            evaluator_provider  TEXT,
                            evaluator_model     TEXT,
                            context             TEXT,
                            created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            completed_at        DATETIME,
                            FOREIGN KEY (template_id) REFERENCES evaluation_templates(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_evaluation_runs_session ON evaluation_runs(session_id, created_at DESC);
                        CREATE INDEX idx_evaluation_runs_template ON evaluation_runs(template_id, created_at DESC);",
                    )?;
                }

                if !table_exists(conn, "evaluation_results")? {
                    conn.execute_batch(
                        "CREATE TABLE evaluation_results (
                            id                 TEXT PRIMARY KEY,
                            evaluation_run_id  TEXT NOT NULL,
                            criterion_name     TEXT NOT NULL,
                            score              REAL NOT NULL,
                            reasoning          TEXT,
                            suggestions        TEXT,
                            FOREIGN KEY (evaluation_run_id) REFERENCES evaluation_runs(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_evaluation_results_run ON evaluation_results(evaluation_run_id);",
                    )?;
                }

                info!("Evaluation tables created successfully");
                Ok(())
            },
        },

        // v39: Enhance session_summaries
        Migration {
            version: 39,
            description: "enhance session_summaries with extended fields for AI summary",
            up: |conn| {
                if !table_exists(conn, "session_summaries")? {
                    conn.execute_batch(
                        "CREATE TABLE session_summaries (
                            id            INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id    TEXT NOT NULL,
                            summary       TEXT NOT NULL,
                            key_points    TEXT,
                            ai_provider   TEXT,
                            ai_model      TEXT,
                            input_tokens  INTEGER,
                            output_tokens INTEGER,
                            tokens_used   INTEGER,
                            cost_usd      REAL,
                            quality_score INTEGER,
                            summary_type  TEXT NOT NULL DEFAULT 'auto'
                                          CHECK(summary_type IN ('auto', 'manual', 'key_points')),
                            updated_at    DATETIME,
                            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
                        );
                        CREATE INDEX idx_session_summaries_session
                            ON session_summaries(session_id, created_at DESC);",
                    )?;
                    info!("session_summaries table created with new schema");
                } else {
                    add_column_if_not_exists(conn, "session_summaries", "summary", "TEXT NOT NULL")?;
                    add_column_if_not_exists(conn, "session_summaries", "key_points", "TEXT")?;
                    add_column_if_not_exists(conn, "session_summaries", "ai_provider", "TEXT")?;
                    add_column_if_not_exists(conn, "session_summaries", "ai_model", "TEXT")?;
                    add_column_if_not_exists(conn, "session_summaries", "input_tokens", "INTEGER")?;
                    add_column_if_not_exists(conn, "session_summaries", "output_tokens", "INTEGER")?;
                    add_column_if_not_exists(conn, "session_summaries", "tokens_used", "INTEGER")?;
                    add_column_if_not_exists(conn, "session_summaries", "cost_usd", "REAL")?;
                    add_column_if_not_exists(conn, "session_summaries", "quality_score", "INTEGER")?;
                    add_column_if_not_exists(conn, "session_summaries", "summary_type", "TEXT NOT NULL DEFAULT 'auto'")?;
                    add_column_if_not_exists(conn, "session_summaries", "updated_at", "DATETIME")?;
                    let _ = conn.execute_batch(
                        "CREATE INDEX IF NOT EXISTS idx_session_summaries_session ON session_summaries(session_id, created_at DESC);",
                    );
                    info!("session_summaries table enhanced");
                }
                Ok(())
            },
        },

        // v40: Goal Anchor
        Migration {
            version: 40,
            description: "create goals, goal_activities, goal_sessions tables",
            up: |conn| {
                if !table_exists(conn, "goals")? {
                    conn.execute_batch(
                        "CREATE TABLE goals (
                            id           TEXT PRIMARY KEY,
                            title        TEXT NOT NULL,
                            description  TEXT,
                            target_date  DATETIME,
                            status       TEXT NOT NULL DEFAULT 'active'
                                        CHECK(status IN ('active', 'achieved', 'abandoned')),
                            priority     TEXT NOT NULL DEFAULT 'medium'
                                        CHECK(priority IN ('high', 'medium', 'low')),
                            tags         TEXT NOT NULL DEFAULT '[]',
                            progress     INTEGER NOT NULL DEFAULT 0
                                        CHECK(progress >= 0 AND progress <= 100),
                            created_by   TEXT,
                            created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        )",
                    )?;
                }

                if !table_exists(conn, "goal_activities")? {
                    conn.execute_batch(
                        "CREATE TABLE goal_activities (
                            id             TEXT PRIMARY KEY,
                            goal_id        TEXT NOT NULL,
                            type           TEXT NOT NULL
                                          CHECK(type IN ('note', 'reminder', 'checkpoint', 'review')),
                            content        TEXT NOT NULL,
                            progress_before INTEGER,
                            progress_after  INTEGER,
                            session_id     TEXT,
                            created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_goal_activities_goal ON goal_activities(goal_id, created_at DESC);",
                    )?;
                }

                if !table_exists(conn, "goal_sessions")? {
                    conn.execute_batch(
                        "CREATE TABLE goal_sessions (
                            id                  TEXT PRIMARY KEY,
                            goal_id             TEXT NOT NULL,
                            session_id          TEXT NOT NULL,
                            first_mentioned_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            last_mentioned_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            mention_count       INTEGER NOT NULL DEFAULT 1,
                            is_primary          INTEGER NOT NULL DEFAULT 0,
                            FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_goal_sessions_goal ON goal_sessions(goal_id);
                        CREATE INDEX idx_goal_sessions_session ON goal_sessions(session_id);",
                    )?;
                }

                info!("Goal Anchor tables created successfully");
                Ok(())
            },
        },

        // v41: Prompt optimizer basic
        Migration {
            version: 41,
            description: "create prompt_templates, prompt_versions, prompt_tests tables",
            up: |conn| {
                if !table_exists(conn, "prompt_templates")? {
                    conn.execute_batch(
                        "CREATE TABLE prompt_templates (
                            id TEXT PRIMARY KEY,
                            name TEXT NOT NULL,
                            description TEXT,
                            category TEXT,
                            tags TEXT,
                            variables TEXT,
                            current_version_id TEXT,
                            is_active INTEGER DEFAULT 1,
                            created_by TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        );
                        CREATE INDEX idx_prompt_templates_category ON prompt_templates(category);",
                    )?;
                }
                if !table_exists(conn, "prompt_versions")? {
                    conn.execute_batch(
                        "CREATE TABLE prompt_versions (
                            id TEXT PRIMARY KEY,
                            template_id TEXT NOT NULL,
                            version_number INTEGER NOT NULL,
                            content TEXT NOT NULL,
                            system_prompt TEXT,
                            variables_values TEXT,
                            change_notes TEXT,
                            score REAL,
                            test_count INTEGER DEFAULT 0,
                            is_baseline INTEGER DEFAULT 0,
                            created_by TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (template_id) REFERENCES prompt_templates(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_prompt_versions_template ON prompt_versions(template_id);",
                    )?;
                }
                if !table_exists(conn, "prompt_tests")? {
                    conn.execute_batch(
                        "CREATE TABLE prompt_tests (
                            id TEXT PRIMARY KEY,
                            version_id TEXT NOT NULL,
                            test_input TEXT NOT NULL,
                            test_output TEXT,
                            tokens_used INTEGER,
                            duration_ms INTEGER,
                            score REAL,
                            metadata TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (version_id) REFERENCES prompt_versions(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_prompt_tests_version ON prompt_tests(version_id);",
                    )?;
                }
                info!("Prompt Optimizer tables created successfully");
                Ok(())
            },
        },

        // v42: Prompt optimizer advanced
        Migration {
            version: 42,
            description: "create prompt_optimization_runs, prompt_feedback tables",
            up: |conn| {
                if !table_exists(conn, "prompt_optimization_runs")? {
                    conn.execute_batch(
                        "CREATE TABLE prompt_optimization_runs (
                            id TEXT PRIMARY KEY,
                            template_id TEXT NOT NULL,
                            target_version_id TEXT NOT NULL,
                            status TEXT DEFAULT 'running',
                            optimization_strategy TEXT DEFAULT 'auto',
                            prompt_before TEXT,
                            prompt_after TEXT,
                            improvement_score REAL,
                            iterations INTEGER DEFAULT 0,
                            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            completed_at DATETIME,
                            FOREIGN KEY (template_id) REFERENCES prompt_templates(id) ON DELETE CASCADE,
                            FOREIGN KEY (target_version_id) REFERENCES prompt_versions(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_prompt_opt_runs_template ON prompt_optimization_runs(template_id);
                        CREATE INDEX idx_prompt_opt_runs_status ON prompt_optimization_runs(status);",
                    )?;
                }
                if !table_exists(conn, "prompt_feedback")? {
                    conn.execute_batch(
                        "CREATE TABLE prompt_feedback (
                            id TEXT PRIMARY KEY,
                            optimization_run_id TEXT NOT NULL,
                            criterion TEXT NOT NULL,
                            score_before REAL,
                            score_after REAL,
                            feedback_text TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (optimization_run_id) REFERENCES prompt_optimization_runs(id) ON DELETE CASCADE
                        );
                        CREATE INDEX idx_prompt_feedback_run ON prompt_feedback(optimization_run_id);",
                    )?;
                }
                info!("Prompt Optimizer Advanced tables created successfully");
                Ok(())
            },
        },

        // v44: Agent Teams worktree/import/hierarchy
        Migration {
            version: 44,
            description: "add team worktree metadata and hierarchical team support",
            up: |conn| {
                if table_exists(conn, "team_instances")? {
                    add_column_if_not_exists(conn, "team_instances", "parent_team_id", "TEXT")?;
                    add_column_if_not_exists(conn, "team_instances", "worktree_isolation", "INTEGER NOT NULL DEFAULT 0")?;
                }

                if table_exists(conn, "team_members")? {
                    add_column_if_not_exists(conn, "team_members", "work_dir", "TEXT")?;
                    add_column_if_not_exists(conn, "team_members", "worktree_path", "TEXT")?;
                    add_column_if_not_exists(conn, "team_members", "worktree_branch", "TEXT")?;
                    add_column_if_not_exists(conn, "team_members", "worktree_source_repo", "TEXT")?;
                    add_column_if_not_exists(conn, "team_members", "worktree_base_commit", "TEXT")?;
                    add_column_if_not_exists(conn, "team_members", "worktree_base_branch", "TEXT")?;
                }

                info!("Agent Teams worktree fields added successfully");
                Ok(())
            },
        },

        // v45: Provider pinning + categorization
        Migration {
            version: 45,
            description: "add is_pinned and category fields to ai_providers",
            up: |conn| {
                add_column_if_not_exists(conn, "ai_providers", "is_pinned", "INTEGER NOT NULL DEFAULT 0")?;
                add_column_if_not_exists(conn, "ai_providers", "category", "TEXT DEFAULT NULL")?;

                // Set default categories for existing builtin providers
                let _ = conn.execute_batch(
                    "UPDATE ai_providers SET category = 'builtin-cli' WHERE id IN ('claude-code', 'codex', 'gemini-cli', 'qwen-coder') AND category IS NULL;
                     UPDATE ai_providers SET category = 'api-relay' WHERE id IN ('iflow', 'opencode') AND category IS NULL;
                     UPDATE ai_providers SET category = 'custom' WHERE category IS NULL AND is_builtin = 0;",
                );

                info!("Provider is_pinned + category fields added successfully");
                Ok(())
            },
        },

        // v46: Link planner sessions to goals
        Migration {
            version: 46,
            description: "add goal_id to planner sessions",
            up: |conn| {
                if table_exists(conn, "plan_sessions")? {
                    add_column_if_not_exists(conn, "plan_sessions", "goal_id", "TEXT")?;
                    let _ = conn.execute_batch(
                        "CREATE INDEX IF NOT EXISTS idx_plan_sessions_goal ON plan_sessions(goal_id)",
                    );
                }
                info!("Planner goal_id field added successfully");
                Ok(())
            },
        },

        // v47: Per-member Team provider/model/prompt configuration
        Migration {
            version: 47,
            description: "add per-member team provider model and prompt overrides",
            up: |conn| {
                if table_exists(conn, "team_members")? {
                    add_column_if_not_exists(conn, "team_members", "model_override", "TEXT")?;
                    add_column_if_not_exists(conn, "team_members", "prompt_override", "TEXT")?;
                    add_column_if_not_exists(conn, "team_members", "role_system_prompt", "TEXT")?;
                }
                info!("Team member model/prompt fields added successfully");
                Ok(())
            },
        },

        // v48: Session pinning
        Migration {
            version: 48,
            description: "add is_pinned to sessions",
            up: |conn| {
                if table_exists(conn, "sessions")? {
                    add_column_if_not_exists(conn, "sessions", "is_pinned", "INTEGER NOT NULL DEFAULT 0")?;
                    let _ = conn.execute_batch(
                        "CREATE INDEX IF NOT EXISTS idx_sessions_pinned_started ON sessions(is_pinned DESC, started_at DESC)",
                    );
                }
                info!("Session is_pinned field added successfully");
                Ok(())
            },
        },
    ]
}
