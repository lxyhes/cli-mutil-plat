/**
 * 数据库性能优化迁移 - 添加索引
 * Migration 008: Add performance indexes
 * @author weibin
 */

export const migration_008_add_indexes = {
  version: 8,
  name: 'add_performance_indexes',
  description: 'Add indexes to improve query performance for sessions, conversations, activities, agents, and file changes',

  up: (db: any) => {
    console.log('[Migration 008] Adding performance indexes...')

    // ==================== Sessions 表索引 ====================
    // 优化按状态和时间查询活跃会话
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status_started
      ON sessions(status, startedAt DESC);
    `)
    console.log('[Migration 008] Created index: idx_sessions_status_started')

    // 优化按 Provider 查询会话
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_provider
      ON sessions(providerId);
    `)
    console.log('[Migration 008] Created index: idx_sessions_provider')

    // ==================== Conversation Messages 表索引 ====================
    // 优化按会话和时间查询对话历史
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversation_session_timestamp
      ON conversation_messages(sessionId, timestamp DESC);
    `)
    console.log('[Migration 008] Created index: idx_conversation_session_timestamp')

    // 优化按角色查询消息
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversation_role
      ON conversation_messages(sessionId, role);
    `)
    console.log('[Migration 008] Created index: idx_conversation_role')

    // ==================== Activity Events 表索引 ====================
    // 优化按会话和时间查询活动事件
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activity_session_timestamp
      ON activity_events(sessionId, timestamp DESC);
    `)
    console.log('[Migration 008] Created index: idx_activity_session_timestamp')

    // 优化按事件类型查询
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activity_type
      ON activity_events(sessionId, type);
    `)
    console.log('[Migration 008] Created index: idx_activity_type')

    // ==================== Agents 表索引 ====================
    // 优化按父会话和状态查询 Agent
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_parent_status
      ON agents(parentSessionId, status);
    `)
    console.log('[Migration 008] Created index: idx_agents_parent_status')

    // 优化按子会话查询 Agent
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_child_session
      ON agents(childSessionId);
    `)
    console.log('[Migration 008] Created index: idx_agents_child_session')

    // ==================== File Changes 表索引 ====================
    // 优化按会话和时间查询文件改动
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_file_changes_session_timestamp
      ON file_changes(sessionId, timestamp DESC);
    `)
    console.log('[Migration 008] Created index: idx_file_changes_session_timestamp')

    // 优化按文件路径查询
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_file_changes_path
      ON file_changes(filePath);
    `)
    console.log('[Migration 008] Created index: idx_file_changes_path')

    // ==================== Tasks 表索引 ====================
    // 优化按状态查询任务
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status
      ON tasks(status);
    `)
    console.log('[Migration 008] Created index: idx_tasks_status')

    // 优化按会话查询任务
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_session
      ON tasks(sessionId);
    `)
    console.log('[Migration 008] Created index: idx_tasks_session')

    // ==================== Usage 表索引 ====================
    // 优化按会话和日期查询用量
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_session_date
      ON usage(sessionId, date DESC);
    `)
    console.log('[Migration 008] Created index: idx_usage_session_date')

    // 优化按日期查询用量统计
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_date
      ON usage(date DESC);
    `)
    console.log('[Migration 008] Created index: idx_usage_date')

    // ==================== Team Tables 索引 ====================
    // Team Tasks 优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_tasks_instance_status
      ON team_tasks(instanceId, status);
    `)
    console.log('[Migration 008] Created index: idx_team_tasks_instance_status')

    // Team Members 优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_members_instance
      ON team_members(instanceId);
    `)
    console.log('[Migration 008] Created index: idx_team_members_instance')

    // Team Messages 优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_messages_instance_timestamp
      ON team_messages(instanceId, timestamp DESC);
    `)
    console.log('[Migration 008] Created index: idx_team_messages_instance_timestamp')

    // ==================== Logs 表索引 ====================
    // 优化日志搜索
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_session_timestamp
      ON logs(sessionId, timestamp DESC);
    `)
    console.log('[Migration 008] Created index: idx_logs_session_timestamp')

    // 全文搜索索引（如果支持 FTS）
    // 注意：better-sqlite3 支持 FTS5，但需要单独创建虚拟表
    // 这里先创建基础索引，FTS 可以后续添加

    console.log('[Migration 008] All performance indexes created successfully')
  },

  down: (db: any) => {
    console.log('[Migration 008] Removing performance indexes...')

    // 删除所有索引（按创建顺序的逆序）
    const indexes = [
      'idx_logs_session_timestamp',
      'idx_team_messages_instance_timestamp',
      'idx_team_members_instance',
      'idx_team_tasks_instance_status',
      'idx_usage_date',
      'idx_usage_session_date',
      'idx_tasks_session',
      'idx_tasks_status',
      'idx_file_changes_path',
      'idx_file_changes_session_timestamp',
      'idx_agents_child_session',
      'idx_agents_parent_status',
      'idx_activity_type',
      'idx_activity_session_timestamp',
      'idx_conversation_role',
      'idx_conversation_session_timestamp',
      'idx_sessions_provider',
      'idx_sessions_status_started'
    ]

    for (const index of indexes) {
      db.exec(`DROP INDEX IF EXISTS ${index}`)
      console.log(`[Migration 008] Dropped index: ${index}`)
    }

    console.log('[Migration 008] All performance indexes removed')
  }
}
