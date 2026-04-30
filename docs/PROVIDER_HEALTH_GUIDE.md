# Provider 健康检查与自动切换功能

## 概述

Provider 健康检查服务提供以下功能：

1. **定期检查**：每隔一定时间检查各 Provider 的可用性
2. **状态追踪**：记录每个 Provider 的健康状态历史
3. **自动切换**：当主 Provider 失败时，自动切换到备用 Provider
4. **智能推荐**：基于健康状态和响应时间推荐最佳 Provider

## API 使用

### 启动/停止健康检查

```typescript
// 启动健康检查
await window.spectrAI.providerHealth.start()

// 停止健康检查
await window.spectrAI.providerHealth.stop()
```

### 查询健康状态

```typescript
// 获取所有 Provider 的健康状态
const { statuses } = await window.spectrAI.providerHealth.getAll()
console.log(statuses) // Array of ProviderHealthStatus

// 获取单个 Provider 的健康状态
const { status } = await window.spectrAI.providerHealth.getStatus('claude-code')
console.log(status) // ProviderHealthStatus or undefined

// 获取所有健康的 Provider
const { providers } = await window.spectrAI.providerHealth.getHealthy()
console.log(providers) // Array of AIProvider
```

### 获取推荐的 Provider

```typescript
// 获取推荐的最佳 Provider（考虑首选 Provider）
const { provider } = await window.spectrAI.providerHealth.getRecommended('claude-code')
if (provider) {
  console.log(`推荐使用: ${provider.name}`)
} else {
  console.log('没有可用的 Provider')
}
```

### 手动触发健康检查

```typescript
// 手动检查某个 Provider
const { result } = await window.spectrAI.providerHealth.checkManual('claude-code')
console.log(result) // HealthCheckResult
```

### 配置管理

```typescript
// 更新配置
await window.spectrAI.providerHealth.updateConfig({
  enabled: true,                    // 启用健康检查
  maxConsecutiveFailures: 3,        // 最大连续失败次数
  minSuccessRate: 0.7,              // 最小成功率
  checkIntervalMs: 60000,           // 检查间隔（毫秒）
  fallbackProviderIds: ['codex', 'gemini-cli'], // 备用 Provider 列表
})

// 获取当前配置
const { config } = await window.spectrAI.providerHealth.getConfig()
console.log(config)
```

## 健康状态说明

每个 Provider 的健康状态包含以下字段：

```typescript
interface ProviderHealthStatus {
  providerId: string           // Provider ID
  providerName: string         // Provider 名称
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'  // 健康状态
  lastCheckedAt: string        // 最后检查时间（ISO 格式）
  responseTimeMs?: number      // 响应时间（毫秒）
  errorMessage?: string        // 错误信息（如果有）
  consecutiveFailures: number  // 连续失败次数
  successRate: number          // 最近10次检查的成功率（0-1）
}
```

### 状态判定规则

- **healthy**: 连续失败次数 < 阈值 且 成功率 >= 最小值
- **degraded**: 连续失败次数 < 阈值 但 成功率 < 最小值
- **unhealthy**: 连续失败次数 >= 阈值
- **unknown**: 尚未进行检查

## 自动切换机制

当 Provider 变为 `unhealthy` 状态时，系统会：

1. 检查配置的备用 Provider 列表
2. 找到第一个状态为 `healthy` 的备用 Provider
3. 发射 `auto-switch` 事件，通知前端进行切换

### 监听自动切换事件

```typescript
// TODO: 实现事件监听接口
// 目前需要通过轮询 getRecommended() 来获取推荐 Provider
```

## 使用场景

### 场景 1: 会话创建时选择 Provider

```typescript
async function createSessionWithBestProvider(taskDescription: string) {
  // 根据任务类型确定首选 Provider
  let preferredProvider = 'claude-code' // 默认
  
  if (taskDescription.includes('代码生成')) {
    preferredProvider = 'codex'
  } else if (taskDescription.includes('大文件分析')) {
    preferredProvider = 'gemini-cli'
  }
  
  // 获取推荐的健康 Provider
  const { provider } = await window.spectrAI.providerHealth.getRecommended(preferredProvider)
  
  if (!provider) {
    throw new Error('没有可用的 Provider')
  }
  
  // 使用推荐的 Provider 创建会话
  return await window.spectrAI.session.create({
    providerId: provider.id,
    // ... 其他配置
  })
}
```

### 场景 2: Provider 故障时自动重试

```typescript
async function sendMessageWithFallback(sessionId: string, message: string) {
  try {
    await window.spectrAI.session.sendMessage(sessionId, message)
  } catch (error) {
    console.warn('发送消息失败，尝试切换到备用 Provider')
    
    // 获取推荐的 Provider
    const { provider } = await window.spectrAI.providerHealth.getRecommended()
    
    if (provider) {
      console.log(`切换到 Provider: ${provider.name}`)
      // TODO: 实现会话迁移逻辑
      // await migrateSessionToProvider(sessionId, provider.id)
    }
    
    throw error
  }
}
```

### 场景 3: 显示 Provider 健康状态面板

```tsx
function ProviderHealthPanel() {
  const [statuses, setStatuses] = useState<ProviderHealthStatus[]>([])
  
  useEffect(() => {
    // 加载健康状态
    loadHealthStatuses()
    
    // 定期刷新（每30秒）
    const interval = setInterval(loadHealthStatuses, 30000)
    return () => clearInterval(interval)
  }, [])
  
  async function loadHealthStatuses() {
    const { statuses } = await window.spectrAI.providerHealth.getAll()
    setStatuses(statuses)
  }
  
  return (
    <div className="provider-health-panel">
      <h3>Provider 健康状态</h3>
      {statuses.map(status => (
        <div key={status.providerId} className={`provider-status ${status.status}`}>
          <span className="provider-name">{status.providerName}</span>
          <span className="status-indicator">
            {status.status === 'healthy' && '✅'}
            {status.status === 'degraded' && '⚠️'}
            {status.status === 'unhealthy' && '❌'}
            {status.status === 'unknown' && '❓'}
          </span>
          {status.responseTimeMs && (
            <span className="response-time">{status.responseTimeMs}ms</span>
          )}
          {status.errorMessage && (
            <span className="error-message" title={status.errorMessage}>
              !
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
```

## 配置建议

### 开发环境

```typescript
{
  enabled: false,  // 开发时禁用，避免干扰调试
  maxConsecutiveFailures: 5,
  minSuccessRate: 0.5,
  checkIntervalMs: 120000,  // 2分钟检查一次
  fallbackProviderIds: []
}
```

### 生产环境

```typescript
{
  enabled: true,
  maxConsecutiveFailures: 3,
  minSuccessRate: 0.7,
  checkIntervalMs: 60000,  // 1分钟检查一次
  fallbackProviderIds: ['claude-code', 'codex', 'gemini-cli']
}
```

### 高可用环境

```typescript
{
  enabled: true,
  maxConsecutiveFailures: 2,  // 更敏感
  minSuccessRate: 0.8,        // 更高要求
  checkIntervalMs: 30000,     // 30秒检查一次
  fallbackProviderIds: ['claude-code', 'codex', 'gemini-cli', 'opencode']
}
```

## 注意事项

1. **性能影响**：健康检查会定期调用 Provider，可能产生少量 API 调用费用
2. **网络依赖**：健康检查依赖网络连接，网络不稳定时可能误判
3. **CLI Provider**：对于 CLI-based Provider（如 Claude Code），健康检查只验证命令是否可用，不会实际执行任务
4. **API Provider**：对于 API-based Provider，健康检查会尝试连接 API 端点

## 故障排查

### 问题：健康检查一直显示 "unknown"

**原因**：健康检查未启动或 Provider 未注册

**解决**：
```typescript
// 确保已启动健康检查
await window.spectrAI.providerHealth.start()

// 检查是否有 Provider
const providers = await window.spectrAI.provider.getAll()
console.log('Registered providers:', providers.length)
```

### 问题：Provider 显示 "unhealthy" 但实际可用

**原因**：可能是临时网络问题或检查逻辑过于严格

**解决**：
```typescript
// 手动重新检查
await window.spectrAI.providerHealth.checkManual('provider-id')

// 或者调整配置，降低敏感度
await window.spectrAI.providerHealth.updateConfig({
  maxConsecutiveFailures: 5,  // 增加容忍度
  minSuccessRate: 0.5,        // 降低成功率要求
})
```

### 问题：自动切换不工作

**原因**：未配置备用 Provider 或备用 Provider 也不健康

**解决**：
```typescript
// 检查配置
const { config } = await window.spectrAI.providerHealth.getConfig()
console.log('Fallback providers:', config.fallbackProviderIds)

// 添加备用 Provider
await window.spectrAI.providerHealth.updateConfig({
  fallbackProviderIds: ['claude-code', 'codex', 'gemini-cli']
})

// 检查备用 Provider 的健康状态
const { statuses } = await window.spectrAI.providerHealth.getAll()
statuses.forEach(s => {
  console.log(`${s.providerId}: ${s.status}`)
})
```

## 未来改进方向

1. **更智能的健康检查**：根据不同 Provider 类型采用不同的检查策略
2. **预测性切换**：基于历史数据预测 Provider 可能的故障
3. **负载均衡**：在多个健康的 Provider 之间分配负载
4. **成本优化**：结合成本信息选择性价比最高的 Provider
5. **用户反馈循环**：允许用户标记 Provider 的实际表现，优化健康检查算法
