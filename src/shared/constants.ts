// ============================================================
// SpectrAI 常量定义
// @author weibin
// @test 文件资源跟踪状态变化测试（可安全删除此注释）
// ============================================================

import type { KanbanColumn, ThemeConfig } from './types'

// ---- IPC 通道名称 ----

export const IPC = {
  // 主进程 → 渲染进程
  SESSION_OUTPUT: 'session:output',
  SESSION_STATUS_CHANGE: 'session:status-change',
  SESSION_ACTIVITY: 'session:activity',
  SESSION_INTERVENTION: 'session:intervention',

  // 渲染进程 → 主进程 (invoke)
  SESSION_CREATE: 'session:create',
  SESSION_TERMINATE: 'session:terminate',
  SESSION_SEND_INPUT: 'session:send-input',
  SESSION_CONFIRM: 'session:confirm',
  SESSION_RESIZE: 'session:resize',
  SESSION_GET_ALL: 'session:get-all',
  SESSION_GET_STATS: 'session:get-stats',
  SESSION_GET_HISTORY: 'session:get-history',
  SESSION_GET_ACTIVITIES: 'session:get-activities',
  SESSION_RESUME: 'session:resume',
  SESSION_NAME_CHANGE: 'session:name-change',
  SESSION_REFRESH: 'session:refresh',  // 会话列表刷新（远程创建/终止会话时触发）
  SESSION_GET_LOGS: 'session:get-logs',
  SESSION_GET_OUTPUT: 'session:get-output',
  SESSION_RENAME: 'session:rename',
  SESSION_SET_MODEL: 'session:set-model',
  SESSION_AI_RENAME: 'session:ai-rename',
  SESSION_DELETE: 'session:delete',

  // SDK V2: 对话 API
  SESSION_SEND_MESSAGE: 'session:send-message',
  SESSION_CONVERSATION_MESSAGE: 'session:conversation-message',
  SESSION_CONVERSATION_HISTORY: 'session:conversation-history',
  SESSION_PERMISSION_REQUEST: 'session:permission-request',
  SESSION_PERMISSION_RESPOND: 'session:permission-respond',
  SESSION_INIT_DATA: 'session:init-data',           // 会话初始化数据（tools/skills/mcp）
  SESSION_AUTH_REQUIRED: 'session:auth-required',   // Provider 需要认证（如 Qwen CLI 需要 qwen auth）
  SESSION_TOKEN_UPDATE: 'session:token-update',     // SDK V2: 实时 token 用量推送（主进程 → 渲染进程）
  SESSION_ABORT: 'session:abort',                   // SDK V2: 中断当前正在执行的轮次（软中断，会话保持可用）
  SESSION_ANSWER_QUESTION: 'session:answer-question',   // 用户回答 AskUserQuestion
  SESSION_APPROVE_PLAN: 'session:approve-plan',          // 用户审批/拒绝 ExitPlanMode
  SESSION_GET_QUEUE: 'session:get-queue',                // SDK V2: 获取排队中的消息列表
  SESSION_CLEAR_QUEUE: 'session:clear-queue',            // SDK V2: 清空排队中的消息（用户主动取消）
  SESSION_PREWARM: 'session:prewarm',                   // SDK V2: iFlow 预热（提前完成握手，不发送首条消息）

  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_GET_ALL: 'task:get-all',
  TASK_STATUS_CHANGE: 'task:status-change',
  TASK_START_SESSION: 'task:start-session',


  SEARCH_LOGS: 'search:logs',
  USAGE_GET_SUMMARY: 'usage:get-summary',
  USAGE_GET_HISTORY: 'usage:get-history',
  USAGE_FLUSH: 'usage:flush',

  DIRECTORY_GET_RECENT: 'directory:get-recent',
  DIRECTORY_TOGGLE_PIN: 'directory:toggle-pin',
  DIRECTORY_REMOVE: 'directory:remove',

  PROVIDER_GET_ALL: 'provider:get-all',
  PROVIDER_GET: 'provider:get',
  PROVIDER_CREATE: 'provider:create',
  PROVIDER_UPDATE: 'provider:update',
  PROVIDER_DELETE: 'provider:delete',
  PROVIDER_REORDER: 'provider:reorder',
  PROVIDER_CHECK_CLI: 'provider:check-cli',
  /** 测试 claude-sdk 可执行文件路径（自动检测或验证指定路径） */
  PROVIDER_TEST_EXECUTABLE: 'provider:test-executable',
  /** 在系统终端中运行 Provider 认证命令（如 qwen auth） */
  PROVIDER_RUN_AUTH_CLI: 'provider:run-auth-cli',
  /** 收藏/取消收藏 Provider */
  PROVIDER_TOGGLE_PIN: 'provider:toggle-pin',
  /** 打开文件选择对话框，返回选中文件路径 */
  DIALOG_SELECT_FILE: 'dialog:select-file',

  // Node 版本管理
  NVM_LIST_VERSIONS: 'nvm:list-versions',

  // 主题
  THEME_UPDATE_TITLE_BAR: 'theme:update-title-bar',


  // 文件系统
  FS_SAVE_IMAGE_TO_TEMP: 'fs:save-image-to-temp',

  // 日志
  LOG_GET_RECENT: 'log:get-recent',
  LOG_OPEN_FILE: 'log:open-file',

  // 全局应用设置
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_UPDATE: 'settings:update',

  // 内存管理
  MEMORY_GET_REPORT: 'memory:get-report',
  MEMORY_FORCE_CLEANUP: 'memory:force-cleanup',

  // 多维度专家分析
  ANALYZER_START: 'analyzer:start',
  ANALYZER_GET_REPORT: 'analyzer:get-report',
  ANALYZER_GET_ALL_REPORTS: 'analyzer:get-all-reports',

  // Agent Teams
  TEAM_CREATE: 'team:create',
  TEAM_GET_ALL: 'team:get-all',
  TEAM_GET: 'team:get',
  TEAM_GET_TASKS: 'team:get-tasks',
  TEAM_GET_MESSAGES: 'team:get-messages',
  TEAM_CREATE_TASK: 'team:create-task',
  TEAM_COMPLETE_TASK: 'team:complete-task',
  TEAM_GET_TEMPLATES: 'team:get-templates',
  // Agent Teams - 运行时事件（主进程 → 渲染进程）
  TEAM_STATUS_CHANGE: 'team:status-change',
  TEAM_MEMBER_JOINED: 'team:member-joined',
  TEAM_MEMBER_STATUS_CHANGE: 'team:member-status-change',
  TEAM_TASK_CLAIMED: 'team:task-claimed',
  TEAM_TASK_COMPLETED: 'team:task-completed',
  TEAM_TASK_CANCELLED: 'team:task-cancelled',
  TEAM_MESSAGE: 'team:message',
  TEAM_COMPLETED: 'team:completed',
  TEAM_FAILED: 'team:failed',
  TEAM_CANCELLED: 'team:cancelled',
  TEAM_PAUSED: 'team:paused',
  TEAM_RESUMED: 'team:resumed',
  TEAM_UPDATED: 'team:updated',
  TEAM_LOG: 'team:log',
  // Agent Teams - 团队通信（agent 内部调用）
  TEAM_CLAIM_TASK: 'team:claim-task',
  TEAM_BROADCAST: 'team:broadcast',
  TEAM_MESSAGE_ROLE: 'team:message-role',

  // Agent Teams - 增强功能（阶段 1-7）
  TEAM_GET_TASK_DAG: 'team:get-task-dag',
  TEAM_VALIDATE_DEPENDENCIES: 'team:validate-dependencies',
  TEAM_UPDATE_TASK: 'team:update-task',
  TEAM_CANCEL_TASK: 'team:cancel-task',
  TEAM_REASSIGN_TASK: 'team:reassign-task',
  TEAM_RETRY_TASK: 'team:retry-task',
  TEAM_CANCEL: 'team:cancel',
  TEAM_PAUSE: 'team:pause',
  TEAM_RESUME: 'team:resume',
  TEAM_UPDATE: 'team:update',
  TEAM_UPDATE_MEMBER: 'team:update-member',
  TEAM_CREATE_TEMPLATE: 'team:create-template',
  TEAM_UPDATE_TEMPLATE: 'team:update-template',
  TEAM_DELETE_TEMPLATE: 'team:delete-template',
  TEAM_SEND_MESSAGE: 'team:send-message',
  TEAM_UI_BROADCAST: 'team:ui-broadcast',
  TEAM_EXPORT: 'team:export',
  TEAM_IMPORT: 'team:import',
  TEAM_MERGE_WORKTREES: 'team:merge-worktrees',

  // 应用更新
  UPDATE_GET_STATE: 'update:get-state',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_OPEN_DOWNLOAD_PAGE: 'update:open-download-page',
  UPDATE_STATE_CHANGED: 'update:state-changed',

  // Git Worktree 隔离
  GIT_IS_REPO: 'git:is-repo',
  GIT_GET_BRANCHES: 'git:get-branches',
  GIT_GET_CURRENT_BRANCH: 'git:get-current-branch',
  GIT_DETECT_MAIN_BRANCH: 'git:detect-main-branch',
  GIT_GET_REPO_ROOT: 'git:get-repo-root',
  GIT_IS_DIRTY: 'git:is-dirty',
  GIT_GET_STATUS:    'git:get-status',
  GIT_GET_FILE_DIFF: 'git:get-file-diff',
  GIT_STAGE:         'git:stage',
  GIT_UNSTAGE:       'git:unstage',
  GIT_DISCARD:       'git:discard',
  GIT_STAGE_ALL:     'git:stage-all',
  GIT_COMMIT:        'git:commit',
  GIT_PULL:          'git:pull',
  GIT_PUSH:          'git:push',
  GIT_GET_LOG:       'git:get-log',
  GIT_GET_REMOTE_STATUS: 'git:get-remote-status',
  GIT_GET_COMMIT_FILES: 'git:get-commit-files',
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_REMOVE: 'worktree:remove',
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_CHECK_MERGE: 'worktree:check-merge',
  WORKTREE_MERGE: 'worktree:merge',
  WORKTREE_DIFF_SUMMARY: 'worktree:diff-summary',
  WORKTREE_FILE_DIFF: 'worktree:file-diff',

  // Workspace 工作区管理
  WORKSPACE_LIST:          'workspace:list',
  WORKSPACE_GET:           'workspace:get',
  WORKSPACE_CREATE:        'workspace:create',
  WORKSPACE_UPDATE:        'workspace:update',
  WORKSPACE_DELETE:        'workspace:delete',
  WORKSPACE_SCAN_REPOS:    'workspace:scan-repos',
  WORKSPACE_IMPORT_VSCODE: 'workspace:import-vscode',

  // MCP 管理
  MCP_GET_ALL: 'mcp:get-all',
  MCP_GET: 'mcp:get',
  MCP_CREATE: 'mcp:create',
  MCP_UPDATE: 'mcp:update',
  MCP_DELETE: 'mcp:delete',
  MCP_TOGGLE: 'mcp:toggle',
  MCP_TEST_CONNECTION: 'mcp:test-connection',
  MCP_GET_FOR_PROVIDER: 'mcp:get-for-provider',
  MCP_INSTALL: 'mcp:install',
  MCP_INSTALL_PROGRESS: 'mcp:install-progress',

  // Skill 技能管理
  SKILL_GET_ALL: 'skill:get-all',
  SKILL_GET: 'skill:get',
  SKILL_CREATE: 'skill:create',
  SKILL_UPDATE: 'skill:update',
  SKILL_DELETE: 'skill:delete',
  SKILL_TOGGLE: 'skill:toggle',
  SKILL_EXECUTE: 'skill:execute',
  SKILL_GET_BY_COMMAND: 'skill:get-by-command',

  // Provider 能力查询
  PROVIDER_GET_CAPABILITY: 'provider:get-capability',
  PROVIDER_GET_ALL_CAPABILITIES: 'provider:get-all-capabilities',

  // 在线市场（Registry）
  REGISTRY_FETCH_MCPS: 'registry:fetch-mcps',
  REGISTRY_FETCH_SKILLS: 'registry:fetch-skills',
  REGISTRY_FORCE_REFRESH: 'registry:force-refresh',
  REGISTRY_GET_SOURCES: 'registry:get-sources',
  REGISTRY_FETCH_SKILLS_FROM_SOURCE: 'registry:fetch-skills-from-source',
  REGISTRY_FETCH_TRENDING: 'registry:fetch-trending',
  SKILL_IMPORT_URL: 'skill:import-url',
  /** 主进程通知渲染进程：有新 Skill 通过 MCP 安装，需要刷新列表 */
  SKILL_INSTALLED_NOTIFY: 'skill:installed-notify',

  // Telegram 远程控制
  TELEGRAM_GET_CONFIG:      'telegram:get-config',
  TELEGRAM_SET_CONFIG:      'telegram:set-config',
  TELEGRAM_DELETE_CONFIG:   'telegram:delete-config',
  TELEGRAM_GET_STATUS:      'telegram:get-status',
  TELEGRAM_TEST_CONNECTION: 'telegram:test-connection',
  TELEGRAM_GET_MAPPINGS:    'telegram:get-mappings',
  TELEGRAM_ADD_MAPPING:     'telegram:add-mapping',
  TELEGRAM_REMOVE_MAPPING:  'telegram:remove-mapping',
  TELEGRAM_STATUS_CHANGED:  'telegram:status-changed',
  TELEGRAM_MESSAGE_SENT:    'telegram:message-sent',

  // 飞书集成
  FEISHU_GET_CONFIG:      'feishu:get-config',
  FEISHU_SET_CONFIG:      'feishu:set-config',
  FEISHU_DELETE_CONFIG:   'feishu:delete-config',
  FEISHU_GET_STATUS:      'feishu:get-status',
  FEISHU_TEST_CONNECTION:  'feishu:test-connection',
  FEISHU_GET_MAPPINGS:   'feishu:get-mappings',
  FEISHU_ADD_MAPPING:    'feishu:add-mapping',
  FEISHU_REMOVE_MAPPING: 'feishu:remove-mapping',
  FEISHU_STATUS_CHANGED: 'feishu:status-changed',
  FEISHU_MESSAGE_SENT:    'feishu:message-sent',

  // 定时任务调度
  SCHEDULER_GET_TASKS:      'scheduler:get-tasks',
  SCHEDULER_GET_TASK:       'scheduler:get-task',
  SCHEDULER_CREATE_TASK:    'scheduler:create-task',
  SCHEDULER_UPDATE_TASK:    'scheduler:update-task',
  SCHEDULER_DELETE_TASK:    'scheduler:delete-task',
  SCHEDULER_TRIGGER_RUN:    'scheduler:trigger-run',
  SCHEDULER_GET_RUNS:       'scheduler:get-runs',
  SCHEDULER_GET_RECENT_RUNS: 'scheduler:get-recent-runs',
  SCHEDULER_TASK_STATUS:    'scheduler:task-status',

  // 会话摘要
  SUMMARY_GENERATE:       'summary:generate',
  SUMMARY_GET:            'summary:get',
  SUMMARY_LIST:           'summary:list',
  SUMMARY_UPDATE:         'summary:update',
  SUMMARY_DELETE:         'summary:delete',
  SUMMARY_LIST_ALL:       'summary:list-all',

  // 自主规划引擎
  PLAN_CREATE:        'plan:create',
  PLAN_LIST:          'plan:list',
  PLAN_GET:           'plan:get',
  PLAN_UPDATE:        'plan:update',
  PLAN_DELETE:        'plan:delete',
  PLAN_START:         'plan:start',
  PLAN_SYNC_TO_KANBAN:'plan:sync-to-kanban',
  PLAN_STEP_EXECUTE:  'plan:step-execute',
  PLAN_GET_STEPS:     'plan:get-steps',
  PLAN_STEP_UPDATE:   'plan:step-update',
  PLAN_STATUS:        'plan:status',

  // 工作流编排
  WORKFLOW_CREATE:      'workflow:create',
  WORKFLOW_LIST:        'workflow:list',
  WORKFLOW_GET:         'workflow:get',
  WORKFLOW_UPDATE:      'workflow:update',
  WORKFLOW_DELETE:      'workflow:delete',
  WORKFLOW_EXECUTE:     'workflow:execute',
  WORKFLOW_PAUSE:       'workflow:pause',
  WORKFLOW_RESUME:      'workflow:resume',
  WORKFLOW_GET_RUNS:    'workflow:get-runs',
  WORKFLOW_GET_EXECUTION: 'workflow:get-execution',
  WORKFLOW_GET_EXECUTIONS: 'workflow:get-executions',
  WORKFLOW_STATUS:      'workflow:status',

  // 任务评估
  EVAL_CREATE_TEMPLATE:  'eval:create-template',
  EVAL_LIST_TEMPLATES:    'eval:list-templates',
  EVAL_GET_TEMPLATE:     'eval:get-template',
  EVAL_UPDATE_TEMPLATE:  'eval:update-template',
  EVAL_DELETE_TEMPLATE:  'eval:delete-template',
  EVAL_RUN_START:        'eval:run-start',
  EVAL_LIST_RUNS:        'eval:list-runs',
  EVAL_GET_RUN:          'eval:get-run',
  EVAL_GET_RESULTS:      'eval:get-results',
  EVAL_RUN_STATUS:       'eval:run-status',

  // Goal Anchor 目标锚点
  GOAL_CREATE:          'goal:create',
  GOAL_LIST:            'goal:list',
  GOAL_GET:             'goal:get',
  GOAL_UPDATE:          'goal:update',
  GOAL_DELETE:          'goal:delete',
  GOAL_ADD_ACTIVITY:    'goal:add-activity',
  GOAL_GET_ACTIVITIES:  'goal:get-activities',
  GOAL_LINK_SESSION:    'goal:link-session',
  GOAL_GET_SESSIONS:    'goal:get-sessions',
  GOAL_GET_STATS:       'goal:get-stats',
  GOAL_STATUS:          'goal:status',
  GOAL_GENERATE_PLAN:   'goal:generate-plan',  // ★ 新增: 从目标生成规划

  // Prompt 优化器（基础 + 高级）
  PROMPT_TEMPLATE_CREATE:    'prompt-template:create',
  PROMPT_TEMPLATE_LIST:     'prompt-template:list',
  PROMPT_TEMPLATE_GET:       'prompt-template:get',
  PROMPT_TEMPLATE_UPDATE:    'prompt-template:update',
  PROMPT_TEMPLATE_DELETE:    'prompt-template:delete',
  PROMPT_VERSION_CREATE:     'prompt-version:create',
  PROMPT_VERSION_LIST:      'prompt-version:list',
  PROMPT_VERSION_UPDATE:     'prompt-version:update',
  PROMPT_VERSION_SET_BASELINE: 'prompt-version:set-baseline',
  PROMPT_VERSION_DELETE:      'prompt-version:delete',
  PROMPT_TEST_CREATE:       'prompt-test:create',
  PROMPT_TEST_LIST:         'prompt-test:list',
  PROMPT_TEST_GET_STATS:    'prompt-test:get-stats',
  PROMPT_RUN_TEST:          'prompt:run-test',
  PROMPT_COMPARE:           'prompt:compare',
  PROMPT_OPTIMIZE_AUTO:     'prompt:optimize-auto',
  PROMPT_OPTIMIZE_HINTS:    'prompt:optimize-hints',
  PROMPT_OPTIMIZATION_STATUS: 'prompt:optimization-status',
  PROMPT_OPTIMIZATION_GET_RUN:  'prompt:optimization:get-run',
  PROMPT_OPTIMIZATION_LIST_RUNS: 'prompt:optimization:list-runs',
  PROMPT_OPTIMIZATION_GET_FEEDBACK: 'prompt:optimization:get-feedback',
  PROMPT_GET_BEST_VERSION:  'prompt:get-best-version',
  PROMPT_PROMOTE_BEST:      'prompt:promote-best',
  PROMPT_GET_EVOLUTION:     'prompt:get-evolution',

  // 会话级工作记忆 (Working Context)
  WORKING_CONTEXT_GET:          'working-context:get',
  WORKING_CONTEXT_UPDATE_TASK:  'working-context:update-task',
  WORKING_CONTEXT_ADD_PROBLEM:  'working-context:add-problem',
  WORKING_CONTEXT_RESOLVE_PROBLEM: 'working-context:resolve-problem',
  WORKING_CONTEXT_ADD_DECISION: 'working-context:add-decision',
  WORKING_CONTEXT_ADD_TODO:     'working-context:add-todo',
  WORKING_CONTEXT_RESOLVE_TODO: 'working-context:resolve-todo',
  WORKING_CONTEXT_ADD_SNIPPET:  'working-context:add-snippet',
  WORKING_CONTEXT_REMOVE_ITEM:  'working-context:remove-item',
  WORKING_CONTEXT_CREATE_SNAPSHOT: 'working-context:create-snapshot',
  WORKING_CONTEXT_GET_PROMPT:   'working-context:get-prompt',
  WORKING_CONTEXT_STATUS:       'working-context:status',

  // 漂移检测护栏 (Drift Guard)
  DRIFT_GUARD_START:       'drift-guard:start',
  DRIFT_GUARD_STOP:        'drift-guard:stop',
  DRIFT_GUARD_GET_STATE:   'drift-guard:get-state',
  DRIFT_GUARD_RESUME:      'drift-guard:resume',
  DRIFT_GUARD_GET_PROMPT:  'drift-guard:get-prompt',
  DRIFT_GUARD_UPDATE_CONFIG: 'drift-guard:update-config',
  DRIFT_GUARD_GET_CONFIG:  'drift-guard:get-config',
  DRIFT_GUARD_STATUS:      'drift-guard:status',

  // 跨会话语义记忆 (Cross-Session Memory)
  CROSS_MEMORY_SEARCH:     'cross-memory:search',
  CROSS_MEMORY_LIST:       'cross-memory:list',
  CROSS_MEMORY_INDEX:      'cross-memory:index',
  CROSS_MEMORY_DELETE:     'cross-memory:delete',
  CROSS_MEMORY_GET_PROMPT: 'cross-memory:get-prompt',
  CROSS_MEMORY_GET_STATS:  'cross-memory:get-stats',
  CROSS_MEMORY_UPDATE_CONFIG: 'cross-memory:update-config',

  // 会话模板 (Session Template)
  SESSION_TEMPLATE_LIST:     'session-template:list',
  SESSION_TEMPLATE_GET:      'session-template:get',
  SESSION_TEMPLATE_CREATE:   'session-template:create',
  SESSION_TEMPLATE_UPDATE:   'session-template:update',
  SESSION_TEMPLATE_DELETE:   'session-template:delete',
  SESSION_TEMPLATE_GET_CATEGORIES: 'session-template:get-categories',
  SESSION_TEMPLATE_STATUS:   'session-template:status',

  // 代码上下文注入 (Code Context Injection)
  CODE_CONTEXT_INJECT:      'code-context:inject',
  CODE_CONTEXT_GET_MODES:   'code-context:get-modes',

  // 代码图谱 / 爆炸半径
  CODE_GRAPH_INDEX_PROJECT:     'code-graph:index-project',
  CODE_GRAPH_GET_STATS:         'code-graph:get-stats',
  CODE_GRAPH_GET_DEPENDENCIES:  'code-graph:get-dependencies',
  CODE_GRAPH_GET_DEPENDENTS:    'code-graph:get-dependents',
  CODE_GRAPH_GET_BLAST_RADIUS:  'code-graph:get-blast-radius',
  CODE_GRAPH_GET_SYMBOLS:       'code-graph:get-symbols',
  CODE_GRAPH_GET_SYMBOL_BLAST_RADIUS: 'code-graph:get-symbol-blast-radius',

  // OpenAI Compatible Provider
  OPENAI_COMPAT_TEST:       'openai-compat:test',
  OPENAI_COMPAT_CREATE:     'openai-compat:create',

  // ═══════════════════════════════════════════════════════
  // ★ 新增 10 大功能 IPC 通道
  // ═══════════════════════════════════════════════════════

  // 1. 智能回溯 (Time Travel / Checkpoint)
  CHECKPOINT_CREATE:        'checkpoint:create',
  CHECKPOINT_LIST:          'checkpoint:list',
  CHECKPOINT_GET:           'checkpoint:get',
  CHECKPOINT_RESTORE:       'checkpoint:restore',
  CHECKPOINT_DELETE:        'checkpoint:delete',
  CHECKPOINT_DIFF:          'checkpoint:diff',
  CHECKPOINT_AUTO_CREATE:   'checkpoint:auto-create',
  CHECKPOINT_GET_PROMPT:    'checkpoint:get-prompt',
  CHECKPOINT_CREATED:       'checkpoint:created',       // 主进程→渲染进程：新快照创建通知
  CHECKPOINT_SETTINGS:      'checkpoint:settings',      // 获取/设置自动快照配置

  // 2. 成本仪表盘 (Cost Dashboard)
  COST_GET_SUMMARY:         'cost:get-summary',
  COST_GET_HISTORY:         'cost:get-history',
  COST_GET_BY_SESSION:      'cost:get-by-session',
  COST_GET_BY_PROVIDER:     'cost:get-by-provider',
  COST_SET_BUDGET:          'cost:set-budget',
  COST_GET_BUDGET:          'cost:get-budget',
  COST_GET_PRICING:         'cost:get-pricing',
  COST_UPDATE_PRICING:      'cost:update-pricing',
  COST_BUDGET_ALERT:        'cost:budget-alert',        // 主进程→渲染进程：预算告警通知

  // 3. 项目级知识库 (Project Knowledge Base)
  PROJECT_KB_CREATE:        'project-kb:create',
  PROJECT_KB_GET:           'project-kb:get',
  PROJECT_KB_UPDATE:        'project-kb:update',
  PROJECT_KB_DELETE:        'project-kb:delete',
  PROJECT_KB_LIST:          'project-kb:list',
  PROJECT_KB_ADD_ENTRY:     'project-kb:add-entry',
  PROJECT_KB_REMOVE_ENTRY:  'project-kb:remove-entry',
  PROJECT_KB_SEARCH:        'project-kb:search',
  PROJECT_KB_GET_PROMPT:    'project-kb:get-prompt',
  PROJECT_KB_AUTO_EXTRACT:     'project-kb:auto-extract',
  PROJECT_KB_EXTRACT_SESSION:  'project-kb:extract-session',
  PROJECT_KB_DELETE_BATCH:  'project-kb:delete-batch',
  PROJECT_KB_UPDATE_BATCH: 'project-kb:update-batch',
  PROJECT_KB_EXPORT:        'project-kb:export',
  PROJECT_KB_IMPORT:        'project-kb:import',

  // 3b. 参考项目 (Reference Projects)
  REFERENCE_SEARCH:           'reference:search',
  REFERENCE_REPO_TREE:        'reference:repo-tree',
  REFERENCE_FILE_CONTENT:     'reference:file-content',
  REFERENCE_SAVE_TO_KB:       'reference:save-to-kb',
  REFERENCE_SAVE:             'reference:save',
  REFERENCE_LIST:            'reference:list',
  REFERENCE_DELETE:           'reference:delete',
  REFERENCE_SUGGEST:         'reference:suggest',

  // 4. AI 代码审查员 (Code Review Copilot)
  CODE_REVIEW_START:        'code-review:start',
  CODE_REVIEW_GET:          'code-review:get',
  CODE_REVIEW_LIST:         'code-review:list',
  CODE_REVIEW_GET_COMMENTS: 'code-review:get-comments',
  CODE_REVIEW_RESOLVE_COMMENT: 'code-review:resolve-comment',
  CODE_REVIEW_APPLY_FIX:    'code-review:apply-fix',
  CODE_REVIEW_GET_PROMPT:   'code-review:get-prompt',
  CODE_REVIEW_STATUS:       'code-review:status',
  CODE_REVIEW_SETTINGS:     'code-review:settings',     // 获取/设置自动审查配置
  CODE_REVIEW_COMPLETED:    'code-review:completed',     // 主进程→渲染进程：审查完成通知

  // 5. 会话录像与回放 (Session Replay)
  REPLAY_START_RECORDING:   'replay:start-recording',
  REPLAY_STOP_RECORDING:    'replay:stop-recording',
  REPLAY_GET:               'replay:get',
  REPLAY_LIST:              'replay:list',
  REPLAY_DELETE:            'replay:delete',
  REPLAY_EXPORT:            'replay:export',
  REPLAY_GET_EVENTS:        'replay:get-events',
  REPLAY_SETTINGS:          'replay:settings',           // 获取/设置录制配置
  REPLAY_IS_RECORDING:      'replay:is-recording',       // 查询会话是否在录制中

  // 6. 智能上下文管理器 (Context Budget Manager)
  CONTEXT_BUDGET_GET:       'context-budget:get',
  CONTEXT_BUDGET_UPDATE:    'context-budget:update',
  CONTEXT_BUDGET_COMPRESS:  'context-budget:compress',
  CONTEXT_BUDGET_MIGRATE:   'context-budget:migrate',
  CONTEXT_BUDGET_STATUS:    'context-budget:status',
  CONTEXT_BUDGET_ALERT:     'context-budget:alert',

  // 7. AI 对决模式 (AI Battle / A/B Compare)
  BATTLE_CREATE:            'battle:create',
  BATTLE_GET:               'battle:get',
  BATTLE_LIST:              'battle:list',
  BATTLE_VOTE:              'battle:vote',
  BATTLE_DELETE:            'battle:delete',
  BATTLE_GET_STATS:         'battle:get-stats',

  // 8. 每日 AI 日报 (Daily AI Report)
  DAILY_REPORT_GENERATE:    'daily-report:generate',
  DAILY_REPORT_GET:         'daily-report:get',
  DAILY_REPORT_LIST:        'daily-report:list',
  DAILY_REPORT_EXPORT:      'daily-report:export',
  DAILY_REPORT_CONFIG:      'daily-report:config',
  DAILY_REPORT_DELETE:      'daily-report:delete',

  // 9. AI 技能竞技场 (Skill Arena)
  SKILL_ARENA_LIST:         'skill-arena:list',
  SKILL_ARENA_SUBMIT:       'skill-arena:submit',
  SKILL_ARENA_GET_SCORES:   'skill-arena:get-scores',
  SKILL_ARENA_GET_LEADERBOARD: 'skill-arena:get-leaderboard',
  SKILL_ARENA_VOTE:         'skill-arena:vote',
  SKILL_ARENA_DELETE:       'skill-arena:delete',
  SKILL_ARENA_CATEGORIES:   'skill-arena:categories',
  SKILL_ARENA_GET_STATS:    'skill-arena:get-stats',

  // 社区一键发布
  COMMUNITY_PUBLISH_SKILL:    'community:publish-skill',
  COMMUNITY_PUBLISH_MCP:      'community:publish-mcp',
  COMMUNITY_PUBLISH_WORKFLOW: 'community:publish-workflow',
  COMMUNITY_PUBLISH_PROMPT:   'community:publish-prompt',
  COMMUNITY_IMPORT_JSON:      'community:import-json',
  COMMUNITY_IMPORT_URL:       'community:import-url',
  COMMUNITY_PUBLISH_STATUS:   'community:publish-status',

  // 10. 语音交互 (Voice Mode)
  VOICE_START_LISTENING:    'voice:start-listening',
  VOICE_STOP_LISTENING:     'voice:stop-listening',
  VOICE_SPEAK:              'voice:speak',
  VOICE_GET_STATUS:         'voice:get-status',
  VOICE_GET_CONFIG:         'voice:get-config',
  VOICE_UPDATE_CONFIG:      'voice:update-config',
  VOICE_TRANSCRIBE:         'voice:transcribe',
  VOICE_GET_HISTORY:        'voice:get-history',
  VOICE_CLEAR_HISTORY:      'voice:clear-history',
  VOICE_SIMULATE_INPUT:     'voice:simulate-input',
} as const

// ---- 看板列 ----

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'todo', title: '待办', icon: 'Circle' },
  { id: 'in_progress', title: '进行中', icon: 'Play' },
  { id: 'waiting', title: '等待中', icon: 'Pause' },
  { id: 'done', title: '已完成', icon: 'CheckCircle' },
]

// ---- 快捷键 ----

export const SHORTCUTS = {
  GRID_VIEW: 'Ctrl+1',
  FOCUS_VIEW: 'Ctrl+2',
  DASHBOARD_VIEW: 'Ctrl+3',
  KANBAN_VIEW: 'Ctrl+4',
  CYCLE_TERMINALS: 'Ctrl+Tab',
  NEW_SESSION: 'Ctrl+N',
  NEW_TASK_AND_SESSION: 'Ctrl+Shift+N',
  TOGGLE_SIDEBAR: 'Ctrl+B',
} as const

// ---- 会话状态颜色 ----

export const STATUS_COLORS: Record<string, string> = {
  starting: '#D29922',
  running: '#3FB950',
  idle: '#8B949E',
  waiting_input: '#D29922',
  paused: '#8B949E',
  completed: '#58A6FF',
  error: '#F85149',
  terminated: '#484F58',
  interrupted: '#D29922',
}

// ---- 会话状态标签 ----

export const STATUS_LABELS: Record<string, string> = {
  starting: '正在启动',
  running: '正在处理',
  idle: '等你开始',
  waiting_input: '等你继续',
  paused: '已暂停',
  completed: '已完成',
  error: '需要处理',
  terminated: '已结束',
  interrupted: '已暂停',
}

// ---- 优先级颜色 ----

export const PRIORITY_COLORS: Record<string, string> = {
  low: '#58A6FF',
  medium: '#D29922',
  high: '#F85149',
}

// ---- 主题注册表 ----

export const THEMES: Record<string, ThemeConfig> = {
  dark: {
    id: 'dark',
    name: 'GitHub Dark',
    type: 'dark',
    colors: {
      bg: { primary: '#0D1117', secondary: '#161B22', tertiary: '#21262D', hover: '#30363D' },
      text: { primary: '#E6EDF3', secondary: '#8B949E', muted: '#484F58' },
      accent: { blue: '#58A6FF', green: '#3FB950', yellow: '#D29922', red: '#F85149', purple: '#BC8CFF' },
      border: '#30363D',
    },
    terminal: {
      bg: '#0D1117', fg: '#E6EDF3', cursor: '#58A6FF',
      black: '#484F58', red: '#FF7B72', green: '#3FB950', yellow: '#D29922',
      blue: '#58A6FF', magenta: '#BC8CFF', cyan: '#39C5CF', white: '#B1BAC4',
      brightBlack: '#6E7681', brightRed: '#FFA198', brightGreen: '#56D364', brightYellow: '#E3B341',
      brightBlue: '#79C0FF', brightMagenta: '#D2A8FF', brightCyan: '#56D4DD', brightWhite: '#F0F6FC',
    },
  },

  light: {
    id: 'light',
    name: 'GitHub Light',
    type: 'light',
    colors: {
      bg: { primary: '#FFFFFF', secondary: '#F6F8FA', tertiary: '#F0F2F5', hover: '#E8EAED' },
      text: { primary: '#1F2328', secondary: '#57606A', muted: '#8C959F' },
      accent: { blue: '#0969DA', green: '#1A7F37', yellow: '#BF8700', red: '#D1242F', purple: '#8250DF' },
      border: '#D0D7DE',
    },
    terminal: {
      bg: '#FFFFFF', fg: '#1F2328', cursor: '#0969DA',
      black: '#24292F', red: '#D1242F', green: '#1A7F37', yellow: '#BF8700',
      blue: '#0969DA', magenta: '#8250DF', cyan: '#1B7C83', white: '#6E7781',
      brightBlack: '#57606A', brightRed: '#E4523F', brightGreen: '#2DA44E', brightYellow: '#D4A72C',
      brightBlue: '#218BFF', brightMagenta: '#A475F9', brightCyan: '#3192AA', brightWhite: '#8C959F',
    },
  },

  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    type: 'dark',
    colors: {
      bg: { primary: '#002B36', secondary: '#073642', tertiary: '#0A4050', hover: '#124D5C' },
      text: { primary: '#FDF6E3', secondary: '#93A1A1', muted: '#657B83' },
      accent: { blue: '#268BD2', green: '#859900', yellow: '#B58900', red: '#DC322F', purple: '#6C71C4' },
      border: '#0A4050',
    },
    terminal: {
      bg: '#002B36', fg: '#FDF6E3', cursor: '#268BD2',
      black: '#073642', red: '#DC322F', green: '#859900', yellow: '#B58900',
      blue: '#268BD2', magenta: '#D33682', cyan: '#2AA198', white: '#EEE8D5',
      brightBlack: '#586E75', brightRed: '#CB4B16', brightGreen: '#859900', brightYellow: '#B58900',
      brightBlue: '#268BD2', brightMagenta: '#6C71C4', brightCyan: '#2AA198', brightWhite: '#FDF6E3',
    },
  },

  nord: {
    id: 'nord',
    name: 'Nord',
    type: 'dark',
    colors: {
      bg: { primary: '#2E3440', secondary: '#3B4252', tertiary: '#434C5E', hover: '#4C566A' },
      text: { primary: '#ECEFF4', secondary: '#D8DEE9', muted: '#7B88A1' },
      accent: { blue: '#88C0D0', green: '#A3BE8C', yellow: '#EBCB8B', red: '#BF616A', purple: '#B48EAD' },
      border: '#4C566A',
    },
    terminal: {
      bg: '#2E3440', fg: '#ECEFF4', cursor: '#88C0D0',
      black: '#3B4252', red: '#BF616A', green: '#A3BE8C', yellow: '#EBCB8B',
      blue: '#81A1C1', magenta: '#B48EAD', cyan: '#88C0D0', white: '#E5E9F0',
      brightBlack: '#4C566A', brightRed: '#BF616A', brightGreen: '#A3BE8C', brightYellow: '#EBCB8B',
      brightBlue: '#81A1C1', brightMagenta: '#B48EAD', brightCyan: '#8FBCBB', brightWhite: '#ECEFF4',
    },
  },

  // ---- VS Code 常见主题 ----

  'one-dark-pro': {
    id: 'one-dark-pro',
    name: 'One Dark Pro',
    type: 'dark',
    colors: {
      bg: { primary: '#282C34', secondary: '#21252B', tertiary: '#1E2227', hover: '#2C313C' },
      text: { primary: '#ABB2BF', secondary: '#636D83', muted: '#4B5363' },
      accent: { blue: '#61AFEF', green: '#98C379', yellow: '#E5C07B', red: '#E06C75', purple: '#C678DD' },
      border: '#3E4451',
    },
    terminal: {
      bg: '#282C34', fg: '#ABB2BF', cursor: '#528BFF',
      black: '#3F4451', red: '#E06C75', green: '#98C379', yellow: '#E5C07B',
      blue: '#61AFEF', magenta: '#C678DD', cyan: '#56B6C2', white: '#A0A0A0',
      brightBlack: '#4F5666', brightRed: '#E06C75', brightGreen: '#98C379', brightYellow: '#E5C07B',
      brightBlue: '#61AFEF', brightMagenta: '#C678DD', brightCyan: '#56B6C2', brightWhite: '#ABB2BF',
    },
  },

  dracula: {
    id: 'dracula',
    name: 'Dracula',
    type: 'dark',
    colors: {
      bg: { primary: '#282A36', secondary: '#21222C', tertiary: '#191A21', hover: '#44475A' },
      text: { primary: '#F8F8F2', secondary: '#6272A4', muted: '#44475A' },
      accent: { blue: '#8BE9FD', green: '#50FA7B', yellow: '#F1FA8C', red: '#FF5555', purple: '#BD93F9' },
      border: '#44475A',
    },
    terminal: {
      bg: '#282A36', fg: '#F8F8F2', cursor: '#F8F8F2',
      black: '#21222C', red: '#FF5555', green: '#50FA7B', yellow: '#F1FA8C',
      blue: '#BD93F9', magenta: '#FF79C6', cyan: '#8BE9FD', white: '#F8F8F2',
      brightBlack: '#6272A4', brightRed: '#FF6E6E', brightGreen: '#69FF94', brightYellow: '#FFFFA5',
      brightBlue: '#D6ACFF', brightMagenta: '#FF92DF', brightCyan: '#A4FFFF', brightWhite: '#FFFFFF',
    },
  },

  monokai: {
    id: 'monokai',
    name: 'Monokai',
    type: 'dark',
    colors: {
      bg: { primary: '#272822', secondary: '#1E1F1B', tertiary: '#1A1B18', hover: '#3E3D32' },
      text: { primary: '#F8F8F2', secondary: '#90908A', muted: '#5C5C50' },
      accent: { blue: '#66D9E8', green: '#A6E22E', yellow: '#E6DB74', red: '#F92672', purple: '#AE81FF' },
      border: '#3E3D32',
    },
    terminal: {
      bg: '#272822', fg: '#F8F8F2', cursor: '#F8F8F0',
      black: '#272822', red: '#F92672', green: '#A6E22E', yellow: '#F4BF75',
      blue: '#66D9E8', magenta: '#AE81FF', cyan: '#A1EFE4', white: '#F8F8F2',
      brightBlack: '#75715E', brightRed: '#F92672', brightGreen: '#A6E22E', brightYellow: '#F4BF75',
      brightBlue: '#66D9E8', brightMagenta: '#AE81FF', brightCyan: '#A1EFE4', brightWhite: '#F9F8F5',
    },
  },

  'tokyo-night': {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    type: 'dark',
    colors: {
      bg: { primary: '#1A1B26', secondary: '#16161E', tertiary: '#13131A', hover: '#292E42' },
      text: { primary: '#C0CAF5', secondary: '#787C99', muted: '#3B3D57' },
      accent: { blue: '#7AA2F7', green: '#9ECE6A', yellow: '#E0AF68', red: '#F7768E', purple: '#BB9AF7' },
      border: '#292E42',
    },
    terminal: {
      bg: '#1A1B26', fg: '#A9B1D6', cursor: '#C0CAF5',
      black: '#32344A', red: '#F7768E', green: '#9ECE6A', yellow: '#E0AF68',
      blue: '#7AA2F7', magenta: '#AD8EE6', cyan: '#449DAB', white: '#787C99',
      brightBlack: '#444B6A', brightRed: '#FF7A93', brightGreen: '#B9F27C', brightYellow: '#FF9E64',
      brightBlue: '#7DA6FF', brightMagenta: '#BB9AF7', brightCyan: '#0DB9D7', brightWhite: '#ACB0D0',
    },
  },

  catppuccin: {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    type: 'dark',
    colors: {
      bg: { primary: '#1E1E2E', secondary: '#181825', tertiary: '#11111B', hover: '#313244' },
      text: { primary: '#CDD6F4', secondary: '#A6ADC8', muted: '#6C7086' },
      accent: { blue: '#89B4FA', green: '#A6E3A1', yellow: '#F9E2AF', red: '#F38BA8', purple: '#CBA6F7' },
      border: '#45475A',
    },
    terminal: {
      bg: '#1E1E2E', fg: '#CDD6F4', cursor: '#F5E0DC',
      black: '#45475A', red: '#F38BA8', green: '#A6E3A1', yellow: '#F9E2AF',
      blue: '#89B4FA', magenta: '#F5C2E7', cyan: '#94E2D5', white: '#BAC2DE',
      brightBlack: '#585B70', brightRed: '#F38BA8', brightGreen: '#A6E3A1', brightYellow: '#F9E2AF',
      brightBlue: '#89B4FA', brightMagenta: '#F5C2E7', brightCyan: '#94E2D5', brightWhite: '#A6ADC8',
    },
  },

  'ayu-light': {
    id: 'ayu-light',
    name: 'Ayu Light',
    type: 'light',
    colors: {
      bg: { primary: '#FAFAFA', secondary: '#F3F4F5', tertiary: '#E7E8E9', hover: '#D9DADB' },
      text: { primary: '#575F66', secondary: '#8A9199', muted: '#ABB0B6' },
      accent: { blue: '#399EE6', green: '#86B300', yellow: '#F2AE49', red: '#F07171', purple: '#A37ACC' },
      border: '#D9DADB',
    },
    terminal: {
      bg: '#FAFAFA', fg: '#575F66', cursor: '#FF9940',
      black: '#000000', red: '#D32F2F', green: '#388E3C', yellow: '#F57F17',
      blue: '#1565C0', magenta: '#7B1FA2', cyan: '#00838F', white: '#9E9E9E',
      brightBlack: '#757575', brightRed: '#E53935', brightGreen: '#43A047', brightYellow: '#F9A825',
      brightBlue: '#1976D2', brightMagenta: '#8E24AA', brightCyan: '#00ACC1', brightWhite: '#BDBDBD',
    },
  },

  // ---- 护眼主题 ----

  'solarized-light': {
    id: 'solarized-light',
    name: 'Solarized Light',
    type: 'light',
    colors: {
      bg: { primary: '#FDF6E3', secondary: '#EEE8D5', tertiary: '#E4DCCA', hover: '#D8D0BE' },
      text: { primary: '#657B83', secondary: '#839496', muted: '#93A1A1' },
      accent: { blue: '#268BD2', green: '#859900', yellow: '#B58900', red: '#DC322F', purple: '#6C71C4' },
      border: '#D0C9B5',
    },
    terminal: {
      bg: '#FDF6E3', fg: '#657B83', cursor: '#268BD2',
      black: '#073642', red: '#DC322F', green: '#859900', yellow: '#B58900',
      blue: '#268BD2', magenta: '#D33682', cyan: '#2AA198', white: '#EEE8D5',
      brightBlack: '#002B36', brightRed: '#CB4B16', brightGreen: '#586E75', brightYellow: '#657B83',
      brightBlue: '#839496', brightMagenta: '#6C71C4', brightCyan: '#93A1A1', brightWhite: '#FDF6E3',
    },
  },

  gruvbox: {
    id: 'gruvbox',
    name: 'Gruvbox Dark',
    type: 'dark',
    colors: {
      bg: { primary: '#282828', secondary: '#32302F', tertiary: '#3C3836', hover: '#504945' },
      text: { primary: '#EBDBB2', secondary: '#A89984', muted: '#7C6F64' },
      accent: { blue: '#83A598', green: '#B8BB26', yellow: '#FABD2F', red: '#FB4934', purple: '#D3869B' },
      border: '#504945',
    },
    terminal: {
      bg: '#282828', fg: '#EBDBB2', cursor: '#FABD2F',
      black: '#282828', red: '#CC241D', green: '#98971A', yellow: '#D79921',
      blue: '#458588', magenta: '#B16286', cyan: '#689D6A', white: '#A89984',
      brightBlack: '#928374', brightRed: '#FB4934', brightGreen: '#B8BB26', brightYellow: '#FABD2F',
      brightBlue: '#83A598', brightMagenta: '#D3869B', brightCyan: '#8EC07C', brightWhite: '#EBDBB2',
    },
  },
}

/** 获取所有主题 ID 列表 */
export const THEME_IDS = Object.keys(THEMES)

/** 默认主题 ID */
export const DEFAULT_THEME_ID = 'dark'

// ---- 默认配置 ----

export const DEFAULT_CONFIG = {
  maxSessions: 9,
  terminalFontSize: 14,
  terminalFontFamily: 'Cascadia Code, Consolas, monospace',
  sidebarWidth: 280,
  detailPanelWidth: 300,
  logRetentionDays: 30,
  maxLogSizeMB: 500,
  defaultViewMode: 'grid' as const,
}

// ---- 时间阈值 ----

export const THRESHOLDS = {
  IDLE_TIMEOUT_MS: 5000,
  STARTUP_STUCK_MS: 30000,
  POSSIBLE_STUCK_MS: 60000,
  STUCK_INTERVENTION_MS: 300000,
  OUTPUT_BUFFER_MAX_LINES: 10000,
}

// ---- 用量估算 ----

export const USAGE = {
  CHARS_PER_TOKEN_ASCII: 4,
  CHARS_PER_TOKEN_CJK: 2,
  SYSTEM_PROMPT_OVERHEAD: 3000,
  MAX_INJECT_LENGTH: 50000,
}

// ---- 应用信息 ----

export const APP_INFO = {
  NAME: 'PrismOps',
  DESCRIPTION: '多 Agent 编排工作台',
  AUTHOR: 'weibin',
  REPO_URL: 'https://github.com/webin/spectrai',
  LICENSE: 'MIT',
  MIN_ELECTRON_VERSION: '28.0.0',
}
