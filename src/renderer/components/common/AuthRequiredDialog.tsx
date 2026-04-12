/**
 * Provider 认证对话框 - 当 CLI Provider（如 Qwen）需要认证时弹出
 * 提供两种认证方式：
 * 1. 配置 API Key（跳转到 Provider 设置页的"自定义环境变量"）
 * 2. 在终端中运行认证命令
 */

import React, { useState } from 'react'
import { KeyRound, Terminal, X, Settings } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'

const PROVIDER_DISPLAY: Record<string, { name: string; color: string }> = {
  'qwen-coder': { name: 'Qwen Coder', color: '#A855F7' },
  'iflow': { name: 'iFlow', color: '#A78BFA' },
  'claude-code': { name: 'Claude Code', color: '#D97706' },
}

const AuthRequiredDialog: React.FC = () => {
  const authRequiredData = useSessionStore((s) => s.authRequiredData)
  const clearAuthRequiredData = useSessionStore((s) => s.clearAuthRequiredData)
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!authRequiredData) return null

  const { providerId, message, authCommand, requiredEnvKey } = authRequiredData
  const display = PROVIDER_DISPLAY[providerId] || { name: providerId, color: '#6B7280' }

  const handleOpenTerminal = async () => {
    setIsLaunching(true)
    setLaunchError(null)
    try {
      const parts = authCommand.split(' ')
      const command = parts[0]
      const args = parts.slice(1)
      const result = await window.spectrAI.provider.runAuthCli(command, args)
      if (!result.success) {
        setLaunchError(result.error || '打开终端失败')
      }
    } catch (err: any) {
      setLaunchError(err.message || '打开终端失败')
    } finally {
      setIsLaunching(false)
    }
  }

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(authCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenProviderSettings = () => {
    // 打开设置页面并定位到 Provider 配置
    window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'providers' }))
    clearAuthRequiredData()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={clearAuthRequiredData}
    >
      <div
        className="bg-bg-secondary rounded-lg shadow-2xl w-full max-w-md border border-border animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-purple/10">
              <KeyRound className="w-5 h-5 text-accent-purple" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">
              {display.name} 需要授权
            </h2>
          </div>
          <button
            onClick={clearAuthRequiredData}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary btn-transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-4 py-5 space-y-4">
          <p className="text-sm text-text-secondary leading-relaxed">{message}</p>

          {/* 方式1：配置 API Key（当有 requiredEnvKey 时显示） */}
          {requiredEnvKey && (
            <div className="rounded-md border border-accent-purple/30 bg-accent-purple/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-accent-purple shrink-0" />
                <span className="text-xs font-medium text-text-primary">方式一：配置 API Key</span>
              </div>
              <p className="text-xs text-text-secondary pl-5.5">
                在 Provider 设置的"自定义环境变量"中添加：
              </p>
              <div className="flex items-center gap-2 bg-bg-primary rounded px-3 py-2 border border-border ml-5.5">
                <code className="flex-1 text-xs text-accent-purple font-mono">{requiredEnvKey}=sk-xxx</code>
              </div>
              <button
                onClick={handleOpenProviderSettings}
                className="ml-5.5 flex items-center gap-1.5 text-xs text-accent-purple hover:underline"
              >
                <Settings className="w-3 h-3" />
                打开 Provider 设置
              </button>
            </div>
          )}

          {/* 方式2：终端命令 */}
          <div className="rounded-md border border-border bg-bg-hover/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-text-secondary shrink-0" />
              <span className="text-xs font-medium text-text-primary">
                {requiredEnvKey ? '方式二：终端授权' : '在终端中完成授权'}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-bg-primary rounded px-3 py-2 border border-border ml-5.5">
              <code className="flex-1 text-xs text-accent-purple font-mono">{authCommand}</code>
              <button
                onClick={handleCopyCommand}
                className="text-[10px] text-text-tertiary hover:text-text-secondary px-1.5 py-0.5 rounded hover:bg-bg-hover btn-transition shrink-0"
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>

          {/* 错误提示 */}
          {launchError && (
            <div className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded px-3 py-2">
              {launchError}
            </div>
          )}

          <p className="text-xs text-text-tertiary">
            完成授权后，关闭此对话框并重新创建会话即可。
          </p>
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-3 px-4 pb-4">
          <button
            onClick={clearAuthRequiredData}
            className="px-4 py-2 text-sm font-medium rounded bg-bg-hover hover:bg-bg-tertiary text-text-secondary btn-transition"
          >
            稍后再说
          </button>
          {requiredEnvKey && (
            <button
              onClick={handleOpenProviderSettings}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-bg-hover hover:bg-bg-tertiary text-text-primary border border-border btn-transition"
            >
              <Settings className="w-3.5 h-3.5" />
              配置 API Key
            </button>
          )}
          <button
            onClick={handleOpenTerminal}
            disabled={isLaunching}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded text-white btn-transition disabled:opacity-50"
            style={{ backgroundColor: display.color }}
          >
            <Terminal className="w-4 h-4" />
            {isLaunching ? '正在打开...' : '在终端中授权'}
          </button>
        </div>
      </div>
    </div>
  )
}

AuthRequiredDialog.displayName = 'AuthRequiredDialog'

export default AuthRequiredDialog
