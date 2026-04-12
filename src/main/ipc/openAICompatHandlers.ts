/**
 * OpenAI Compatible Provider - IPC Handlers
 * @author weibin
 */

import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { AdapterRegistry } from '../adapter/AdapterRegistry'
import { OpenAICompatibleAdapter } from '../adapter/OpenAICompatibleAdapter'

export function registerOpenAICompatHandlers(adapterRegistry: AdapterRegistry): void {
  /** 测试 OpenAI Compatible API 连通性 */
  ipcMain.handle(IPC.OPENAI_COMPAT_TEST, async (_event, config: {
    baseUrl: string
    apiKey: string
    model?: string
  }) => {
    try {
      const baseUrl = config.baseUrl.replace(/\/$/, '')
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        const text = await response.text()
        return { success: false, error: `API returned ${response.status}: ${text.slice(0, 200)}` }
      }

      const data = await response.json() as any
      const models = (data.data || []).map((m: any) => m.id).slice(0, 20)
      return { success: true, models }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 动态创建并注册 OpenAI Compatible Adapter */
  ipcMain.handle(IPC.OPENAI_COMPAT_CREATE, (_event, config: {
    providerId: string
    displayName: string
    baseUrl: string
    apiKey: string
    defaultModel: string
    maxTokens?: number
    temperature?: number
  }) => {
    try {
      // 如果已注册，先清理
      if (adapterRegistry.has(config.providerId)) {
        try { adapterRegistry.get(config.providerId).cleanup() } catch { /* ignore */ }
      }

      const adapter = new OpenAICompatibleAdapter(config.providerId, config.displayName, {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        defaultModel: config.defaultModel,
        timeout: 120000,
        extraHeaders: {},
        maxTokens: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      })

      adapterRegistry.register(adapter)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
