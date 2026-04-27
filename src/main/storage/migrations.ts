/**
 * migrations.ts — 版本化数据库迁移定义
 * 每个 Migration 包含版本号、描述和 up() 回调。
 * 从原 Database.ts migrateSchema() 拆出，保持执行顺序不变。
 * @author weibin
 */

import { BUILTIN_PROVIDERS } from '../../shared/types'

/** 单条迁移定义 */
export interface Migration {
  /** 唯一递增版本号 */
  version: number
  /** 迁移简要描述（仅用于日志） */
  description: string
  /** 执行迁移（db 为 better-sqlite3 实例） */
  up(db: any): void
}

// ─── 迁移辅助工具 ───

/** 检查某表是否存在 */
function tableExists(db: any, tableName: string): boolean {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName)
}

/** 获取表的所有列名 */
function getColumnNames(db: any, tableName: string): string[] {
  const cols = db.prepare(`PRAGMA table_info('${tableName}')`).all() as any[]
  return cols.map((c: any) => c.name)
}

/** 如果列不存在则添加 */
function addColumnIfNotExists(db: any, table: string, column: string, definition: string): boolean {
  const cols = getColumnNames(db, table)
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    return true
  }
  return false
}

// ─── 所有版本化迁移（按原 migrateSchema 中的顺序排列）───

export const MIGRATIONS: Migration[] = [
  // ── v1: sessions.claude_session_id ──
  {
    version: 1,
    description: 'add claude_session_id column to sessions',
    up(db) {
      addColumnIfNotExists(db, 'sessions', 'claude_session_id', 'TEXT')
    },
  },

  // ── v2: ai_providers 表 ──
  {
    version: 2,
    description: 'create ai_providers table',
    up(db) {
      if (!tableExists(db, 'ai_providers')) {
        db.exec(`
          CREATE TABLE ai_providers (
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
          )
        `)
      }
    },
  },

  // ── v3: ai_providers 新增列（node_version, env_overrides 等）──
  {
    version: 3,
    description: 'add node_version / env_overrides / resume_format / session_id_pattern / executable_path to ai_providers',
    up(db) {
      if (!tableExists(db, 'ai_providers')) return
      addColumnIfNotExists(db, 'ai_providers', 'session_id_detection', 'TEXT')
      addColumnIfNotExists(db, 'ai_providers', 'node_version', 'TEXT')
      addColumnIfNotExists(db, 'ai_providers', 'env_overrides', 'TEXT')
      addColumnIfNotExists(db, 'ai_providers', 'resume_format', 'TEXT')
      addColumnIfNotExists(db, 'ai_providers', 'session_id_pattern', 'TEXT')
      addColumnIfNotExists(db, 'ai_providers', 'executable_path', 'TEXT')
    },
  },

  // ── v4: ai_providers.sort_order ──
  {
    version: 4,
    description: 'add sort_order column to ai_providers',
    up(db) {
      if (!tableExists(db, 'ai_providers')) return
      addColumnIfNotExists(db, 'ai_providers', 'sort_order', 'INTEGER NOT NULL DEFAULT 0')
    },
  },

  // ── v5: ai_providers.git_bash_path ──
  {
    version: 5,
    description: 'add git_bash_path column to ai_providers',
    up(db) {
      if (!tableExists(db, 'ai_providers')) return
      addColumnIfNotExists(db, 'ai_providers', 'git_bash_path', 'TEXT')
    },
  },

  // ── v6: ai_providers.default_model ──
  {
    version: 6,
    description: 'add default_model column to ai_providers',
    up(db) {
      if (!tableExists(db, 'ai_providers')) return
      addColumnIfNotExists(db, 'ai_providers', 'default_model', 'TEXT')
    },
  },

  // ── v7: 内置 provider upsert ──
  {
    version: 7,
    description: 'upsert builtin providers',
    up(db) {
      if (!tableExists(db, 'ai_providers')) return
      const cols = getColumnNames(db, 'ai_providers')
      if (!cols.includes('name')) return  // 表结构不完整则跳过

      const stmt = db.prepare(`
        INSERT OR IGNORE INTO ai_providers (
          id, name, command, is_builtin, icon, default_args,
          auto_accept_arg, resume_arg, session_id_detection,
          node_version, env_overrides, resume_format,
          session_id_pattern, executable_path
        ) VALUES (
          @id, @name, @command, @is_builtin, @icon, @default_args,
          @auto_accept_arg, @resume_arg, @session_id_detection,
          @node_version, @env_overrides, @resume_format,
          @session_id_pattern, @executable_path
        )
      `)
      for (const p of BUILTIN_PROVIDERS) {
        stmt.run({
          id: p.id,
          name: p.name,
          command: p.command,
          is_builtin: 1,
          icon: p.icon || null,
          default_args: p.defaultArgs ? JSON.stringify(p.defaultArgs) : null,
          auto_accept_arg: p.autoAcceptArg || null,
          resume_arg: p.resumeArg || null,
          session_id_detection: p.sessionIdDetection || null,
          node_version: (p as any).nodeVersion || null,
          env_overrides: (p as any).envOverrides ? JSON.stringify((p as any).envOverrides) : null,
          resume_format: (p as any).resumeFormat || null,
          session_id_pattern: (p as any).sessionIdPattern || null,
          executable_path: (p as any).executablePath || null,
        })
      }
    },
  },

  // ── v8: 清理已移除的 aider provider ──
  {
    version: 8,
    description: 'delete removed aider provider',
    up(db) {
      if (!tableExists(db, 'ai_providers')) return
      try {
        db.exec("DELETE FROM ai_providers WHERE id = 'aider' AND is_builtin = 1")
      } catch { /* ignore */ }
    },
  },

  // ── v9: sessions.provider_id + sessions.name_locked ──
  {
    version: 9,
    description: 'add provider_id and name_locked columns to sessions',
    up(db) {
      addColumnIfNotExists(db, 'sessions', 'provider_id', 'TEXT')
      addColumnIfNotExists(db, 'sessions', 'name_locked', 'INTEGER NOT NULL DEFAULT 0')
    },
  },

  // ── v12: session_summaries 表 ──
  {
    version: 12,
    description: 'create session_summaries table',
    up(db) {
      if (!tableExists(db, 'session_summaries')) {
        db.exec(`
          CREATE TABLE session_summaries (
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
          CREATE INDEX IF NOT EXISTS idx_session_summaries_session
            ON session_summaries(session_id, created_at);
        `)
      }
    },
  },

  // ── v13: ai_call_logs 表 ──
  {
    version: 13,
    description: 'create ai_call_logs table',
    up(db) {
      if (!tableExists(db, 'ai_call_logs')) {
        db.exec(`
          CREATE TABLE ai_call_logs (
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
          CREATE INDEX IF NOT EXISTS idx_ai_call_logs_session
            ON ai_call_logs(session_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_ai_call_logs_type
            ON ai_call_logs(call_type, created_at);
        `)
      }
    },
  },

  // ── v14: plan_executions 表 ──
  {
    version: 14,
    description: 'create plan_executions table',
    up(db) {
      if (!tableExists(db, 'plan_executions')) {
        db.exec(`
          CREATE TABLE plan_executions (
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
          CREATE INDEX IF NOT EXISTS idx_plan_executions_session
            ON plan_executions(session_id);
        `)
      }
    },
  },

  // ── v15: tasks worktree 列 ──
  {
    version: 15,
    description: 'add worktree columns to tasks',
    up(db) {
      addColumnIfNotExists(db, 'tasks', 'worktree_enabled', 'INTEGER NOT NULL DEFAULT 0')
      addColumnIfNotExists(db, 'tasks', 'git_repo_path', 'TEXT')
      addColumnIfNotExists(db, 'tasks', 'git_branch', 'TEXT')
      addColumnIfNotExists(db, 'tasks', 'worktree_path', 'TEXT')
    },
  },

  // ── v16: conversation_messages 表 ──
  {
    version: 16,
    description: 'create conversation_messages table',
    up(db) {
      if (!tableExists(db, 'conversation_messages')) {
        db.exec(`
          CREATE TABLE conversation_messages (
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
          CREATE INDEX idx_conv_messages_session ON conversation_messages(session_id, timestamp);
        `)
      } else {
        addColumnIfNotExists(db, 'conversation_messages', 'attachments', 'TEXT')
      }
    },
  },

  // ── v17: app_settings 表 ──
  {
    version: 17,
    description: 'create app_settings table',
    up(db) {
      if (!tableExists(db, 'app_settings')) {
        db.exec(`
          CREATE TABLE app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `)
      }
    },
  },

  // ── v18: workspaces 和 workspace_repos 表 ──
  {
    version: 18,
    description: 'create workspaces and workspace_repos tables',
    up(db) {
      if (!tableExists(db, 'workspaces')) {
        db.exec(`
          CREATE TABLE workspaces (
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
          CREATE INDEX idx_workspace_repos_workspace ON workspace_repos(workspace_id);
        `)
      }
    },
  },

  // ── v19: tasks.workspace_id + tasks.worktree_paths ──
  {
    version: 19,
    description: 'add workspace_id and worktree_paths to tasks',
    up(db) {
      addColumnIfNotExists(db, 'tasks', 'workspace_id', 'TEXT')
      addColumnIfNotExists(db, 'tasks', 'worktree_paths', 'TEXT')
    },
  },

  // ── v20: mcp_servers 表 ──
  {
    version: 20,
    description: 'create mcp_servers table',
    up(db) {
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            category TEXT DEFAULT 'custom',
            transport TEXT NOT NULL DEFAULT 'stdio',
            command TEXT,
            args TEXT,
            url TEXT,
            compatible_providers TEXT NOT NULL DEFAULT '"all"',
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
          )
        `)
      } catch (err) {
        console.error('[Database] Failed to create mcp_servers table:', err)
      }
    },
  },

  // ── v21: chat_task_sessions 表 ──
  {
    version: 21,
    description: 'create chat_task_sessions table',
    up(db) {
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS chat_task_sessions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id    TEXT NOT NULL,
            platform   TEXT NOT NULL,
            session_id TEXT NOT NULL,
            session_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_chat_task_sessions_chat
            ON chat_task_sessions(chat_id, platform, created_at DESC);
        `)
      } catch (err) {
        console.error('[Database] Failed to create chat_task_sessions table:', err)
      }
    },
  },

  // ── v23: skills 表 ──
  {
    version: 23,
    description: 'create skills table',
    up(db) {
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            category TEXT DEFAULT 'general',
            slash_command TEXT,
            type TEXT NOT NULL DEFAULT 'prompt',
            compatible_providers TEXT NOT NULL DEFAULT '"all"',
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
          )
        `)
      } catch (err) {
        console.error('[Database] Failed to create skills table:', err)
      }
    },
  },

  // ── v28: conversation_messages 添加 file_change 列 ──
  {
    version: 28,
    description: 'add file_change column to conversation_messages',
    up(db) {
      addColumnIfNotExists(db, 'conversation_messages', 'file_change', 'TEXT')
    },
  },

  // ── v29: mcp_servers 增加 headers 列（http/sse 模式的自定义请求头） ──
  {
    version: 29,
    description: 'add headers column to mcp_servers',
    up(db) {
      addColumnIfNotExists(db, 'mcp_servers', 'headers', 'TEXT')
    },
  },

  // ── v30: 修复 conversation_messages 表 id 字段类型（INTEGER → TEXT） ──
  {
    version: 30,
    description: 'fix conversation_messages id type from INTEGER to TEXT',
    up(db) {
      try {
        // SQLite 不支持 ALTER COLUMN，需要重建表
        db.exec(`
          -- 1. 创建新表（id 改为 TEXT PRIMARY KEY）
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

          -- 2. 复制数据（rowid 作为临时 id，仅当原 id 为 NULL 时）
          INSERT OR IGNORE INTO conversation_messages_new
          (id, session_id, role, type, content, timestamp, attachments, tool_name, tool_input, tool_result,
           is_error, thinking_text, usage_input_tokens, usage_output_tokens, tool_use_id, file_change)
          SELECT
            COALESCE(CAST(id AS TEXT), 'msg_' || rowid),
            session_id, role, type, content, timestamp, attachments, tool_name, tool_input, tool_result,
            is_error, thinking_text, usage_input_tokens, usage_output_tokens, tool_use_id, file_change
          FROM conversation_messages;

          -- 3. 删除旧表
          DROP TABLE conversation_messages;

          -- 4. 重命名新表
          ALTER TABLE conversation_messages_new RENAME TO conversation_messages;
        `)
        console.log('[Migration v30] Successfully rebuilt conversation_messages table with TEXT id')
      } catch (err) {
        console.error('[Migration v30] Failed to rebuild conversation_messages table:', err)
        // 不抛出异常，允许应用继续运行
      }
    },
  },

  // ── v31: Agent Teams 表 ──
  {
    version: 31,
    description: 'create Agent Teams tables',
    up(db) {
      try {
        // 团队实例表
        if (!tableExists(db, 'team_instances')) {
          db.exec(`
            CREATE TABLE team_instances (
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
            );
          `)
        } else {
          // 修复已存在但缺少列的表
          addColumnIfNotExists(db, 'team_instances', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP')
          addColumnIfNotExists(db, 'team_instances', 'started_at', 'DATETIME')
          addColumnIfNotExists(db, 'team_instances', 'completed_at', 'DATETIME')
          addColumnIfNotExists(db, 'team_instances', 'objective', 'TEXT')
        }

        // 团队成员表
        if (!tableExists(db, 'team_members')) {
          db.exec(`
            CREATE TABLE team_members (
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
            CREATE INDEX idx_team_members_instance ON team_members(instance_id);
          `)
        } else {
          addColumnIfNotExists(db, 'team_members', 'role_name', 'TEXT NOT NULL')
          addColumnIfNotExists(db, 'team_members', 'role_identifier', 'TEXT NOT NULL')
          addColumnIfNotExists(db, 'team_members', 'role_icon', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'role_color', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'current_task_id', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'last_active_at', 'DATETIME')
        }

        // 团队任务表
        if (!tableExists(db, 'team_tasks')) {
          db.exec(`
            CREATE TABLE team_tasks (
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
            CREATE INDEX idx_team_tasks_instance_status ON team_tasks(instance_id, status);
          `)
        } else {
          addColumnIfNotExists(db, 'team_tasks', 'claimed_by', 'TEXT')
          addColumnIfNotExists(db, 'team_tasks', 'claimed_at', 'DATETIME')
          addColumnIfNotExists(db, 'team_tasks', 'priority', 'TEXT NOT NULL DEFAULT \'medium\'')
          addColumnIfNotExists(db, 'team_tasks', 'dependencies', 'TEXT')
          addColumnIfNotExists(db, 'team_tasks', 'result', 'TEXT')
          addColumnIfNotExists(db, 'team_tasks', 'completed_at', 'DATETIME')
        }

        // 团队消息表
        if (!tableExists(db, 'team_messages')) {
          db.exec(`
            CREATE TABLE team_messages (
              id TEXT PRIMARY KEY,
              instance_id TEXT NOT NULL,
              from_member_id TEXT NOT NULL,
              to_member_id TEXT,
              type TEXT NOT NULL DEFAULT 'role_message',
              content TEXT NOT NULL,
              timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_team_messages_instance_timestamp ON team_messages(instance_id, timestamp DESC);
          `)
        } else {
          addColumnIfNotExists(db, 'team_messages', 'timestamp', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP')
        }

        // 团队模板表
        if (!tableExists(db, 'team_templates')) {
          db.exec(`
            CREATE TABLE team_templates (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT,
              roles TEXT NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
          `)
        }

        console.log('[Migration v31] Agent Teams tables created successfully')
      } catch (err) {
        console.error('[Migration v31] Failed to create Agent Teams tables:', err)
      }
    },
  },

  // ── v32: Telegram 远程控制 ──
  {
    version: 32,
    description: 'create telegram_integrations and telegram_chat_mappings tables',
    up(db) {
      try {
        // 主配置表（Token 存运行时内存，此表存开关配置）
        if (!tableExists(db, 'telegram_integrations')) {
          db.exec(`
            CREATE TABLE telegram_integrations (
              id              TEXT PRIMARY KEY,
              enabled         INTEGER NOT NULL DEFAULT 0,
              command_prefix  TEXT NOT NULL DEFAULT '/',
              notify_on_start INTEGER NOT NULL DEFAULT 1,
              notify_on_end   INTEGER NOT NULL DEFAULT 1,
              notify_on_error INTEGER NOT NULL DEFAULT 1,
              created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `)
        }

        // Chat → Session 映射表
        if (!tableExists(db, 'telegram_chat_mappings')) {
          db.exec(`
            CREATE TABLE telegram_chat_mappings (
              id              TEXT PRIMARY KEY,
              integration_id  TEXT NOT NULL,
              chat_id         TEXT NOT NULL,
              session_id      TEXT NOT NULL,
              session_name    TEXT,
              created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(integration_id, chat_id, session_id)
            )
          `)
        }

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_telegram_chat_mappings_chat
            ON telegram_chat_mappings(integration_id, chat_id)
        `)

        console.log('[Migration v32] Telegram tables created successfully')
      } catch (err) {
        console.error('[Migration v32] Failed to create Telegram tables:', err)
      }
    },
  },

  // ── v33: 飞书集成 ──
  {
    version: 33,
    description: 'create feishu integrations and chat mappings tables',
    up(db) {
      try {
        // 飞书主配置表
        if (!tableExists(db, 'feishu_integrations')) {
          db.exec(`
            CREATE TABLE feishu_integrations (
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
            )
          `)
        }

        // 飞书 Chat → Session 映射表
        if (!tableExists(db, 'feishu_chat_mappings')) {
          db.exec(`
            CREATE TABLE feishu_chat_mappings (
              id              TEXT PRIMARY KEY,
              integration_id TEXT NOT NULL,
              chat_id        TEXT NOT NULL,
              chat_name      TEXT,
              session_id     TEXT NOT NULL,
              session_name   TEXT,
              created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(integration_id, chat_id, session_id)
            )
          `)
        }

        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_feishu_chat_mappings_chat
            ON feishu_chat_mappings(integration_id, chat_id)
        `)

        console.log('[Migration v33] Feishu tables created successfully')
      } catch (err) {
        console.error('[Migration v33] Failed to create Feishu tables:', err)
      }
    },
  },

  // ── v34: 定时任务调度 ──
  {
    version: 34,
    description: 'create scheduled_tasks and task_runs tables',
    up(db) {
      try {
        // 定时任务定义表
        if (!tableExists(db, 'scheduled_tasks')) {
          db.exec(`
            CREATE TABLE scheduled_tasks (
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
              is_paused           INTEGER NOT NULL DEFAULT 0,
              max_failures        INTEGER NOT NULL DEFAULT 3,
              timeout_seconds     INTEGER,
              created_by          TEXT,
              created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              last_run_at         DATETIME,
              next_run_at         DATETIME
            )
          `)
        }

        // 任务执行记录表
        if (!tableExists(db, 'task_runs')) {
          db.exec(`
            CREATE TABLE task_runs (
              id                TEXT PRIMARY KEY,
              scheduled_task_id TEXT NOT NULL,
              status            TEXT NOT NULL DEFAULT 'pending'
                                CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout')),
              started_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              completed_at      DATETIME,
              duration_ms       INTEGER,
              session_id        TEXT,
              output            TEXT,
              error             TEXT,
              trigger_type      TEXT NOT NULL DEFAULT 'scheduled'
                                CHECK(trigger_type IN ('scheduled', 'manual', 'api', 'retry')),
              triggered_by      TEXT,
              attempt_number    INTEGER NOT NULL DEFAULT 1,
              previous_run_id   TEXT,
              estimated_tokens  INTEGER,
              FOREIGN KEY (scheduled_task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
            )
          `)
        }

        db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at) WHERE is_enabled = 1`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_scheduled ON task_runs(scheduled_task_id, started_at DESC)`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status) WHERE status IN ('running', 'pending')`)

        console.log('[Migration v34] Scheduler tables created successfully')
      } catch (err) {
        console.error('[Migration v34] Failed to create scheduler tables:', err)
      }
    },
  },

  // ── v35: 自主规划引擎 ──
  {
    version: 35,
    description: 'create plan_sessions, plan_tasks, plan_steps tables',
    up(db) {
      try {
        // 规划会话表
        if (!tableExists(db, 'plan_sessions')) {
          db.exec(`
            CREATE TABLE plan_sessions (
              id          TEXT PRIMARY KEY,
              session_id  TEXT NOT NULL,
              goal        TEXT NOT NULL,
              status      TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending', 'running', 'completed', 'failed')),
              created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              started_at  DATETIME,
              completed_at DATETIME
            )
          `)
        }

        // 规划任务表
        if (!tableExists(db, 'plan_tasks')) {
          db.exec(`
            CREATE TABLE plan_tasks (
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
            )
          `)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_tasks_session ON plan_tasks(plan_session_id, status)`)
        }

        // 规划步骤表
        if (!tableExists(db, 'plan_steps')) {
          db.exec(`
            CREATE TABLE plan_steps (
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
            )
          `)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_steps_task ON plan_steps(plan_task_id, order_index)`)
        }

        console.log('[Migration v35] Planner tables created successfully')
      } catch (err) {
        console.error('[Migration v35] Failed to create planner tables:', err)
      }
    },
  },

  // ── v37: 工作流编排 ──
  {
    version: 37,
    description: 'create workflows, workflow_executions, workflow_runs tables',
    up(db) {
      try {
        // 工作流定义表
        if (!tableExists(db, 'workflows')) {
          db.exec(`
            CREATE TABLE workflows (
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
            )
          `)
        }

        // 工作流执行记录表
        if (!tableExists(db, 'workflow_executions')) {
          db.exec(`
            CREATE TABLE workflow_executions (
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
            )
          `)
        }

        // 工作流步骤运行记录表
        if (!tableExists(db, 'workflow_runs')) {
          db.exec(`
            CREATE TABLE workflow_runs (
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
            )
          `)
        }

        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id, started_at DESC)`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_execution ON workflow_runs(execution_id, step_order)`)

        console.log('[Migration v37] Workflow tables created successfully')
      } catch (err) {
        console.error('[Migration v37] Failed to create workflow tables:', err)
      }
    },
  },

  // ── v38: 任务评估 ──
  {
    version: 38,
    description: 'create evaluation_templates, evaluation_runs, evaluation_results tables',
    up(db) {
      try {
        // 评估模板表
        if (!tableExists(db, 'evaluation_templates')) {
          db.exec(`
            CREATE TABLE evaluation_templates (
              id              TEXT PRIMARY KEY,
              name            TEXT NOT NULL,
              description     TEXT,
              criteria        TEXT NOT NULL,
              prompt_template TEXT NOT NULL,
              created_by      TEXT,
              created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `)
        }

        // 评估运行记录表
        if (!tableExists(db, 'evaluation_runs')) {
          db.exec(`
            CREATE TABLE evaluation_runs (
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
            )
          `)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_evaluation_runs_session ON evaluation_runs(session_id, created_at DESC)`)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_evaluation_runs_template ON evaluation_runs(template_id, created_at DESC)`)
        }

        // 评估结果表
        if (!tableExists(db, 'evaluation_results')) {
          db.exec(`
            CREATE TABLE evaluation_results (
              id                 TEXT PRIMARY KEY,
              evaluation_run_id  TEXT NOT NULL,
              criterion_name     TEXT NOT NULL,
              score              REAL NOT NULL,
              reasoning          TEXT,
              suggestions        TEXT,
              FOREIGN KEY (evaluation_run_id) REFERENCES evaluation_runs(id) ON DELETE CASCADE
            )
          `)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_evaluation_results_run ON evaluation_results(evaluation_run_id)`)
        }

        console.log('[Migration v38] Evaluation tables created successfully')
      } catch (err) {
        console.error('[Migration v38] Failed to create evaluation tables:', err)
      }
    },
  },

  // ── v39: 增强 session_summaries 表 ──
  {
    version: 39,
    description: 'enhance session_summaries with extended fields for AI summary',
    up(db) {
      try {
        if (!tableExists(db, 'session_summaries')) {
          // 表不存在，按新schema创建
          db.exec(`
            CREATE TABLE session_summaries (
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
            CREATE INDEX IF NOT EXISTS idx_session_summaries_session
              ON session_summaries(session_id, created_at DESC);
          `)
          console.log('[Migration v39] session_summaries table created with new schema')
          return
        }

        // 表已存在，检测当前列
        const cols = getColumnNames(db, 'session_summaries')

        // 如果有旧式 type/content/metadata 列（没有 summary），转换为新schema
        if (cols.includes('type') && cols.includes('content') && !cols.includes('summary')) {
          console.log('[Migration v39] Converting session_summaries from old schema (type/content) to new schema (summary/key_points)')
          db.exec(`
            CREATE TABLE session_summaries_new (
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
              summary_type  TEXT NOT NULL DEFAULT 'auto',
              updated_at    DATETIME,
              created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO session_summaries_new (session_id, summary, summary_type, created_at)
            SELECT session_id, content, COALESCE(type, 'auto'), created_at
            FROM session_summaries;
            DROP TABLE session_summaries;
            ALTER TABLE session_summaries_new RENAME TO session_summaries;
          `)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_session_summaries_session ON session_summaries(session_id, created_at DESC);`)
          console.log('[Migration v39] session_summaries converted successfully')
          return
        }

        // 逐步添加缺失列
        addColumnIfNotExists(db, 'session_summaries', 'summary', 'TEXT NOT NULL')
        addColumnIfNotExists(db, 'session_summaries', 'key_points', 'TEXT')
        addColumnIfNotExists(db, 'session_summaries', 'ai_provider', 'TEXT')
        addColumnIfNotExists(db, 'session_summaries', 'ai_model', 'TEXT')
        addColumnIfNotExists(db, 'session_summaries', 'input_tokens', 'INTEGER')
        addColumnIfNotExists(db, 'session_summaries', 'output_tokens', 'INTEGER')
        addColumnIfNotExists(db, 'session_summaries', 'tokens_used', 'INTEGER')
        addColumnIfNotExists(db, 'session_summaries', 'cost_usd', 'REAL')
        addColumnIfNotExists(db, 'session_summaries', 'quality_score', 'INTEGER')
        addColumnIfNotExists(db, 'session_summaries', 'summary_type', "TEXT NOT NULL DEFAULT 'auto'")
        addColumnIfNotExists(db, 'session_summaries', 'updated_at', 'DATETIME')

        try {
          db.exec(`CREATE INDEX IF NOT EXISTS idx_session_summaries_session ON session_summaries(session_id, created_at DESC);`)
        } catch { /* index may already exist */ }

        console.log('[Migration v39] session_summaries table enhanced')
      } catch (err) {
        console.error('[Migration v39] Failed to enhance session_summaries:', err)
      }
    },
  },

  // ── v40: Goal Anchor 目标锚点 ──
  {
    version: 40,
    description: 'create goals, goal_activities, goal_sessions tables',
    up(db) {
      try {
        // 目标定义表
        if (!tableExists(db, 'goals')) {
          db.exec(`
            CREATE TABLE goals (
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
            )
          `)
        }

        // 目标活动记录表
        if (!tableExists(db, 'goal_activities')) {
          db.exec(`
            CREATE TABLE goal_activities (
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
            )
          `)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_goal_activities_goal ON goal_activities(goal_id, created_at DESC)`)
        }

        // 目标-会话关联表
        if (!tableExists(db, 'goal_sessions')) {
          db.exec(`
            CREATE TABLE goal_sessions (
              id                  TEXT PRIMARY KEY,
              goal_id             TEXT NOT NULL,
              session_id          TEXT NOT NULL,
              first_mentioned_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              last_mentioned_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              mention_count       INTEGER NOT NULL DEFAULT 1,
              is_primary          INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
            )
          `)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_goal_sessions_goal ON goal_sessions(goal_id)`)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_goal_sessions_session ON goal_sessions(session_id)`)
        }

        console.log('[Migration v40] Goal Anchor tables created successfully')
      } catch (err) {
        console.error('[Migration v40] Failed to create Goal Anchor tables:', err)
      }
    },
  },

  // ── v41: Prompt 优化器基础版 ──
  {
    version: 41,
    description: 'create prompt_templates, prompt_versions, prompt_tests tables',
    up(db) {
      try {
        if (!tableExists(db, 'prompt_templates')) {
          db.exec(`
            CREATE TABLE prompt_templates (
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
            CREATE INDEX idx_prompt_templates_category ON prompt_templates(category);
          `)
        }
        if (!tableExists(db, 'prompt_versions')) {
          db.exec(`
            CREATE TABLE prompt_versions (
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
            CREATE INDEX idx_prompt_versions_template ON prompt_versions(template_id);
          `)
        }
        if (!tableExists(db, 'prompt_tests')) {
          db.exec(`
            CREATE TABLE prompt_tests (
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
            CREATE INDEX idx_prompt_tests_version ON prompt_tests(version_id);
          `)
        }
        console.log('[Migration v41] Prompt Optimizer tables created successfully')
      } catch (err) {
        console.error('[Migration v41] Failed to create Prompt Optimizer tables:', err)
      }
    },
  },

  // ── v42: Prompt 优化器高级版 ──
  {
    version: 42,
    description: 'create prompt_optimization_runs, prompt_feedback tables',
    up(db) {
      try {
        if (!tableExists(db, 'prompt_optimization_runs')) {
          db.exec(`
            CREATE TABLE prompt_optimization_runs (
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
            CREATE INDEX idx_prompt_opt_runs_status ON prompt_optimization_runs(status);
          `)
        }
        if (!tableExists(db, 'prompt_feedback')) {
          db.exec(`
            CREATE TABLE prompt_feedback (
              id TEXT PRIMARY KEY,
              optimization_run_id TEXT NOT NULL,
              criterion TEXT NOT NULL,
              score_before REAL,
              score_after REAL,
              feedback_text TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (optimization_run_id) REFERENCES prompt_optimization_runs(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_prompt_feedback_run ON prompt_feedback(optimization_run_id);
          `)
        }
        console.log('[Migration v42] Prompt Optimizer Advanced tables created successfully')
      } catch (err) {
        console.error('[Migration v42] Failed to create Prompt Optimizer Advanced tables:', err)
      }
    },
  },

  // ── v43: 添加 qwen-coder provider ──
  {
    version: 43,
    description: 'add qwen-coder builtin provider',
    up(db) {
      if (!tableExists(db, 'ai_providers')) return
      try {
        // 检查是否已存在
        const existing = db.prepare("SELECT id FROM ai_providers WHERE id = 'qwen-coder'").get()
        if (existing) {
          console.log('[Migration v43] qwen-coder provider already exists')
          return
        }

        // 插入 qwen-coder provider
        db.prepare(`
          INSERT INTO ai_providers (
            id, name, command, is_builtin, icon, default_args,
            auto_accept_arg, resume_arg, session_id_detection,
            node_version, env_overrides, resume_format,
            session_id_pattern, executable_path, sort_order, created_at, updated_at
          ) VALUES (
            @id, @name, @command, @is_builtin, @icon, @default_args,
            @auto_accept_arg, @resume_arg, @session_id_detection,
            @node_version, @env_overrides, @resume_format,
            @session_id_pattern, @executable_path, @sort_order, @created_at, @updated_at
          )
        `).run({
          id: 'qwen-coder',
          name: 'Qwen Coder CLI',
          command: 'qwen',
          is_builtin: 1,
          icon: 'qwen',
          default_args: null,
          auto_accept_arg: '--yes',
          resume_arg: '--resume',
          session_id_detection: 'none',
          node_version: null,
          env_overrides: null,
          resume_format: null,
          session_id_pattern: null,
          executable_path: null,
          sort_order: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        console.log('[Migration v43] qwen-coder provider added successfully')
      } catch (err) {
        console.error('[Migration v43] Failed to add qwen-coder provider:', err)
      }
    },
  },

  // ── v44: Agent Teams worktree/import/hierarchy fields ──
  {
    version: 44,
    description: 'add team worktree metadata and hierarchical team support',
    up(db) {
      try {
        if (tableExists(db, 'team_instances')) {
          addColumnIfNotExists(db, 'team_instances', 'parent_team_id', 'TEXT')
          addColumnIfNotExists(db, 'team_instances', 'worktree_isolation', 'INTEGER NOT NULL DEFAULT 0')
        }

        if (tableExists(db, 'team_members')) {
          addColumnIfNotExists(db, 'team_members', 'work_dir', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'worktree_path', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'worktree_branch', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'worktree_source_repo', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'worktree_base_commit', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'worktree_base_branch', 'TEXT')
        }

        console.log('[Migration v44] Agent Teams worktree fields added successfully')
      } catch (err) {
        console.error('[Migration v44] Failed to add Agent Teams worktree fields:', err)
      }
    },
  },

  // ── v45: Provider 收藏 + 分类 ──
  {
    version: 45,
    description: 'add is_pinned and category fields to ai_providers',
    up(db) {
      try {
        addColumnIfNotExists(db, 'ai_providers', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0')
        addColumnIfNotExists(db, 'ai_providers', 'category', 'TEXT DEFAULT NULL')

        // 为现有内置 Provider 设置默认分类
        const builtinCliIds = ['claude-code', 'codex', 'gemini-cli', 'qwen-coder']
        const apiRelayIds = ['iflow', 'opencode']

        const updateStmt = db.prepare('UPDATE ai_providers SET category = ? WHERE id = ? AND category IS NULL')
        for (const id of builtinCliIds) {
          updateStmt.run('builtin-cli', id)
        }
        for (const id of apiRelayIds) {
          updateStmt.run('api-relay', id)
        }
        // 非内置 Provider 默认 custom
        db.prepare("UPDATE ai_providers SET category = 'custom' WHERE category IS NULL AND is_builtin = 0").run()

        console.log('[Migration v45] Provider is_pinned + category fields added successfully')
      } catch (err) {
        console.error('[Migration v45] Failed to add Provider fields:', err)
      }
    },
  },

  // v46: Link planner sessions back to goals
  {
    version: 46,
    description: 'add goal_id to planner sessions',
    up(db) {
      try {
        if (tableExists(db, 'plan_sessions')) {
          addColumnIfNotExists(db, 'plan_sessions', 'goal_id', 'TEXT')
          db.exec('CREATE INDEX IF NOT EXISTS idx_plan_sessions_goal ON plan_sessions(goal_id)')
        }
        console.log('[Migration v46] Planner goal_id field added successfully')
      } catch (err) {
        console.error('[Migration v46] Failed to add planner goal_id field:', err)
      }
    },
  },

  // v47: Per-member Team provider/model/prompt configuration
  {
    version: 47,
    description: 'add per-member team provider model and prompt overrides',
    up(db) {
      try {
        if (tableExists(db, 'team_members')) {
          addColumnIfNotExists(db, 'team_members', 'model_override', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'prompt_override', 'TEXT')
          addColumnIfNotExists(db, 'team_members', 'role_system_prompt', 'TEXT')
        }
        console.log('[Migration v47] Team member model/prompt fields added successfully')
      } catch (err) {
        console.error('[Migration v47] Failed to add team member model/prompt fields:', err)
      }
    },
  },

  // v48: Session pinning
  {
    version: 48,
    description: 'add is_pinned to sessions',
    up(db) {
      try {
        if (tableExists(db, 'sessions')) {
          addColumnIfNotExists(db, 'sessions', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0')
          db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_pinned_started ON sessions(is_pinned DESC, started_at DESC)')
        }
        console.log('[Migration v48] Session is_pinned field added successfully')
      } catch (err) {
        console.error('[Migration v48] Failed to add session is_pinned field:', err)
      }
    },
  },
]
