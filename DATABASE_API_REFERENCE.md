# 📋 DatabaseService API 快速参考

## 🔍 查询方法（Read）

### Session
```rust
list_sessions(limit: i64) -> Vec<SessionRow>
get_session(id: &str) -> Option<SessionRow>
get_session_config(id: &str) -> Option<String>
```

### Provider
```rust
list_providers() -> Vec<ProviderRow>
get_provider(id: &str) -> Option<ProviderRow>
```

### Conversation
```rust
list_conversations(session_id: &str, limit: i64) -> Vec<ConversationRow>
```

### Task
```rust
list_tasks(limit: i64) -> Vec<TaskRow>
```

### Settings
```rust
get_setting(key: &str) -> Option<String>
```

---

## ✏️ 写方法（Write）

### Session (7 个)
```rust
create_session(id, name, status, provider_id, config)
update_session_status(id, status)
end_session(id)                          // 设置 completed + ended_at
set_session_pinned(id, pinned: bool)
rename_session(id, name)
delete_session(id)
```

### Provider (5 个)
```rust
add_provider(id, name, command, is_builtin, icon, api_base_url, 
             api_key, default_model, adapter_type, category)
             
update_provider(id, name?, command?, api_base_url?, api_key?, 
                default_model?, icon?, category?)  // 动态更新
                
delete_provider(id)                      // 仅自定义 provider
set_provider_pinned(id, pinned: bool)
update_provider_sort_order(id, sort_order: i32)
```

### Conversation (4 个)
```rust
insert_conversation(id, session_id, role, content, type?, 
                    tool_name?, tool_input?, tool_result?, 
                    is_error, thinking_text?, 
                    usage_input_tokens?, usage_output_tokens?)
                    
update_conversation(id, content)
delete_conversation(id)
clear_session_conversations(session_id)
```

### Settings (2 个)
```rust
set_setting(key, value)                  // UPSERT
delete_setting(key)
```

### Task (3 个)
```rust
create_task(id, title, status, priority?, workspace_id?)
update_task_status(id, status)
delete_task(id)
```

---

## 🔒 事务支持

```rust
transaction<F, T>(f: F) -> Result<T>
where F: FnOnce(&Connection) -> Result<T>
```

**示例**:
```rust
db.transaction(|conn| {
    conn.execute("INSERT INTO sessions ...", params![...])?;
    conn.execute("INSERT INTO conversation_messages ...", params![...])?;
    Ok(())
})?;
```

---

## 💡 使用提示

### 1. 创建会话流程
```rust
// 1. 创建会话
db.create_session(&id, &name, "running", Some(&provider_id), None)?;

// 2. 插入欢迎消息
db.insert_conversation(&msg_id, &id, "system", "Welcome!", 
                       Some("text"), None, None, None, false, 
                       None, None, None)?;
```

### 2. 保存对话
```rust
// 用户消息
db.insert_conversation(&msg_id, &session_id, "user", &content,
                       Some("text"), None, None, None, false,
                       None, None, None)?;

// AI 回复（带 token 统计）
db.insert_conversation(&msg_id, &session_id, "assistant", &content,
                       Some("text"), None, None, None, false,
                       Some(&thinking), Some(input_tokens), Some(output_tokens))?;
```

### 3. 更新 Provider
```rust
// 只更新 API Key
db.update_provider("claude-code", None, None, None, 
                   Some(&new_key), None, None, None)?;
```

### 4. 批量操作
```rust
db.transaction(|conn| {
    // 多个操作，原子执行
    conn.execute(...)?;
    conn.execute(...)?;
    Ok(())
})?;
```

---

## ⚠️ 注意事项

1. **参数化查询**: 所有方法都使用参数化查询，防止 SQL 注入
2. **内置保护**: `delete_provider()` 不能删除内置 provider (`is_builtin = 1`)
3. **UPSERT**: `set_setting()` 自动处理插入或更新
4. **事务**: 批量操作建议使用 `transaction()` 保证原子性
5. **时间戳**: 所有写操作自动更新 `created_at` / `updated_at`

---

## 📊 完整 API 清单

| 类别 | 查询 | 写入 | 总计 |
|------|------|------|------|
| Session | 3 | 6 | 9 |
| Provider | 2 | 5 | 7 |
| Conversation | 1 | 4 | 5 |
| Settings | 1 | 2 | 3 |
| Task | 1 | 3 | 4 |
| Transaction | 0 | 1 | 1 |
| **总计** | **8** | **21** | **29** |

---

**最后更新**: 2026-05-05  
**Phase 1 状态**: ✅ 95% 完成
