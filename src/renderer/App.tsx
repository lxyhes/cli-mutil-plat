/**
 * SpectrAI 根组件
 * @author weibin
 */

import { useEffect, useRef } from 'react'
import AppLayout from './components/layout/AppLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useSessionStore } from './stores/sessionStore'
import { useTaskStore } from './stores/taskStore'
import { useSkillStore } from './stores/skillStore'
import { useUIStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { voiceStore } from './stores/voiceStore'
import { useContextBudgetStore } from './stores/contextBudgetStore'
import { IPC } from '../shared/constants'
import type { ViewMode } from '../shared/types'
import { isPrimaryModifierPressed } from './utils/shortcut'
import './styles/globals.css'

export default function App() {
  const { fetchSessions, initListeners } = useSessionStore()
  const { fetchTasks } = useTaskStore()
  const { fetchSettings } = useSettingsStore()

  const initialized = useRef(false)

  useEffect(() => {
    // React Strict Mode 会在 dev 模式下执行两次 useEffect，用 ref 防止重复初始化
    if (initialized.current) return
    initialized.current = true

    // 等待 window.spectrAI 可用的辅助函数
    const waitForSpectrAI = (callback: () => void, maxRetries = 50): void => {
      if (window.spectrAI) {
        console.log('[App] window.spectrAI is available')
        callback()
        return
      }
      if (maxRetries <= 0) {
        console.error('[App] window.spectrAI not available after max retries')
        console.error('[App] window object keys:', Object.keys(window).filter(k => k.includes('spectr') || k.includes('Spectr')))
        return
      }
      if (maxRetries % 10 === 0) {
        console.log(`[App] Waiting for window.spectrAI... (${50 - maxRetries}/50)`)
      }
      setTimeout(() => waitForSpectrAI(callback, maxRetries - 1), 100)
    }

    // 注册监听器（含快捷键）
    const cleanups: (() => void)[] = []

    // 初始化监听器（等待 window.spectrAI 可用）
    waitForSpectrAI(() => {
      initListeners()
      useSessionStore.getState().initAgentListeners()
      useSessionStore.getState().initConversationListeners()  // SDK V2 对话事件
      useTaskStore.getState().initTaskListeners()
      // ★ 语音配置预加载（用于 autoSpeak 事件监听）
      voiceStore.loadConfig()
      voiceStore.loadStatus()

      // ★ 上下文预算告警监听：主进程推送超阈值通知时自动刷新当前会话的预算数据
      const budgetApi = (window as any).spectrAI?.contextBudget
      if (budgetApi?.onAlert) {
        budgetApi.onAlert((alert: any) => {
          console.warn('[App] Context budget alert:', alert)
          const sessionId = localStorage.getItem('active-session-id')
          if (sessionId) {
            useContextBudgetStore.getState().fetchBudget(sessionId)
          }
        })
      }

      // MCP install_skill 通知监听：AI 通过 MCP 安装技能后自动刷新列表
      cleanups.push(useSkillStore.getState().initMcpInstallListener())

      // Ctrl+1/2/3/4: 切换视图模式
      cleanups.push(window.spectrAI.shortcut.onViewMode((mode: string) => {
        const validModes: ViewMode[] = ['grid', 'tabs', 'dashboard', 'kanban']
        if (validModes.includes(mode as ViewMode)) {
          useUIStore.getState().setViewMode(mode as ViewMode)
        }
      }))

      // Ctrl+Tab: 循环切换选中会话
      cleanups.push(window.spectrAI.shortcut.onCycleTerminal(() => {
        const { sessions, selectedSessionId, selectSession } = useSessionStore.getState()
        const activeSessions = sessions.filter(
          s => s.status === 'running' || s.status === 'idle' || s.status === 'waiting_input'
        )
        if (activeSessions.length === 0) return

        const currentIdx = activeSessions.findIndex(s => s.id === selectedSessionId)
        const nextIdx = (currentIdx + 1) % activeSessions.length
        selectSession(activeSessions[nextIdx].id)
      }))

      // Ctrl+N: 新建会话
      cleanups.push(window.spectrAI.shortcut.onNewSession(() => {
        useUIStore.getState().setShowNewSessionDialog(true)
      }))

      // Ctrl+Shift+N: 新建任务
      cleanups.push(window.spectrAI.shortcut.onNewTaskSession(() => {
        useUIStore.getState().toggleNewTaskDialog()
      }))

      // Ctrl+B: 切换侧边栏
      cleanups.push(window.spectrAI.shortcut.onToggleSidebar(() => {
        useUIStore.getState().toggleSidebar()
      }))

      // Ctrl+F: 全文搜索
      cleanups.push(window.spectrAI.shortcut.onSearch(() => {
        useUIStore.getState().toggleSearchPanel()
      }))

      // 初始化数据（会话 + 设置），必须在 window.spectrAI 就绪后调用
      Promise.all([fetchSessions(), fetchSettings()]).then(async () => {
        const sessionState = useSessionStore.getState()
        const interruptedCount = sessionState.sessions.filter(
          s => s.status === 'interrupted' && !!s.claudeSessionId
        ).length

        if (interruptedCount === 0) return

        // 有中断会话时自动恢复，无需用户确认
        await sessionState.autoResumeInterrupted()
      })
      fetchTasks()
    })

    // Ctrl/Cmd+Shift+T: 切换主题
    const handleThemeShortcut = (e: KeyboardEvent) => {
      if (isPrimaryModifierPressed(e) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        useUIStore.getState().nextTheme()
      }
    }
    window.addEventListener('keydown', handleThemeShortcut)
    cleanups.push(() => window.removeEventListener('keydown', handleThemeShortcut))

    return () => cleanups.forEach(fn => fn())
  }, [])

  return (
    <ErrorBoundary>
      <AppLayout />
    </ErrorBoundary>
  )
}
