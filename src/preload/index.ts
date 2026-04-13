/**
 * Preload 安全桥接 - 暴露受控的 API 给渲染进程
 * @author weibin
 */
import { ipcRenderer, IpcRendererEvent, clipboard, contextBridge } from 'electron'
import { IPC } from '../shared/constants'

// ★ 调试：记录 preload 脚本开始执行
console.log('[Preload] Script started, contextBridge available:', !!contextBridge)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxBr: any = contextBridge

if (!ctxBr) {
  // eslint-disable-next-line no-console
  console.error('[Preload] contextBridge not available! spectrAI API will not be exposed.')
} else {
  console.log('[Preload] Exposing spectrAI API to renderer...')
  
  const api = {
  // ==================== Clipboard API ====================
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text: string) => clipboard.writeText(text)
  },

  // ==================== Theme API ====================
  theme: {
    updateTitleBar: (themeId: string) => ipcRenderer.send(IPC.THEME_UPDATE_TITLE_BAR, themeId)
  },

  // ==================== Settings API ====================
  settings: {
    getAll: () => ipcRenderer.invoke(IPC.SETTINGS_GET_ALL),
    update: (key: string, value: any) => ipcRenderer.invoke(IPC.SETTINGS_UPDATE, key, value),
  },

  // ==================== File System API ====================
  fs: {
    saveImageToTemp: (base64Data: string, mimeType: string) =>
      ipcRenderer.invoke(IPC.FS_SAVE_IMAGE_TO_TEMP, base64Data, mimeType),
  },

  // ==================== Log API ====================
  log: {
    getRecent: (lines?: number) => ipcRenderer.invoke(IPC.LOG_GET_RECENT, lines),
    openFile: () => ipcRenderer.invoke(IPC.LOG_OPEN_FILE),
  },

  // ==================== Memory API ====================
  memory: {
    getReport: () => ipcRenderer.invoke(IPC.MEMORY_GET_REPORT),
    forceCleanup: (mode?: 'normal' | 'aggressive') => ipcRenderer.invoke(IPC.MEMORY_FORCE_CLEANUP, mode),
  },

  // ==================== App API ====================
  app: {
    getCwd: () => process.cwd(),
    getHomePath: () => require('os').homedir(),
    selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
    selectFile: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_FILE),
    getRecentDirectories: (limit?: number) => ipcRenderer.invoke(IPC.DIRECTORY_GET_RECENT, limit),
    toggleDirectoryPin: (dirPath: string) => ipcRenderer.invoke(IPC.DIRECTORY_TOGGLE_PIN, dirPath),
    removeDirectory: (dirPath: string) => ipcRenderer.invoke(IPC.DIRECTORY_REMOVE, dirPath),
  },

  // ==================== Update API ====================
  update: {
    getState: () => ipcRenderer.invoke(IPC.UPDATE_GET_STATE),
    checkForUpdates: (manual: boolean = true) => ipcRenderer.invoke(IPC.UPDATE_CHECK, manual),
    downloadUpdate: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
    quitAndInstall: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
    openDownloadPage: () => ipcRenderer.invoke(IPC.UPDATE_OPEN_DOWNLOAD_PAGE),
    onStateChanged: (callback: (state: any) => void) => {
      const listener = (_event: IpcRendererEvent, state: any) => callback(state)
      ipcRenderer.on(IPC.UPDATE_STATE_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.UPDATE_STATE_CHANGED, listener)
    },
  },

  // ==================== Session API ====================
  session: {
    create: (config: any) => ipcRenderer.invoke(IPC.SESSION_CREATE, config),

    terminate: (sessionId: string) => ipcRenderer.invoke(IPC.SESSION_TERMINATE, sessionId),

    sendInput: (sessionId: string, input: string) =>
      ipcRenderer.invoke(IPC.SESSION_SEND_INPUT, sessionId, input),

    confirm: (sessionId: string, confirmed: boolean) =>
      ipcRenderer.invoke(IPC.SESSION_CONFIRM, sessionId, confirmed),

    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.SESSION_RESIZE, sessionId, cols, rows),

    getOutput: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_GET_OUTPUT, sessionId),

    getAll: () => ipcRenderer.invoke(IPC.SESSION_GET_ALL),

    getStats: (sessionId: string) => ipcRenderer.invoke(IPC.SESSION_GET_STATS, sessionId),

    getHistory: () => ipcRenderer.invoke(IPC.SESSION_GET_HISTORY),

    getActivities: (sessionId: string, limit?: number) =>
      ipcRenderer.invoke(IPC.SESSION_GET_ACTIVITIES, sessionId, limit),

    resume: (oldSessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_RESUME, oldSessionId),

    getLogs: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_GET_LOGS, sessionId),

    rename: (sessionId: string, newName: string) =>
      ipcRenderer.invoke(IPC.SESSION_RENAME, sessionId, newName),

    aiRename: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_AI_RENAME, sessionId),

    delete: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_DELETE, sessionId),

    // 事件监听（主进程 → 渲染进程）
    onOutput: (callback: (sessionId: string, data: any) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, data: any) => {
        callback(sessionId, data)
      }
      ipcRenderer.on(IPC.SESSION_OUTPUT, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_OUTPUT, listener)
    },

    onStatusChange: (callback: (sessionId: string, status: string) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, status: string) => {
        callback(sessionId, status)
      }
      ipcRenderer.on(IPC.SESSION_STATUS_CHANGE, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_STATUS_CHANGE, listener)
    },

    onActivity: (callback: (sessionId: string, activity: any) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, activity: any) => {
        callback(sessionId, activity)
      }
      ipcRenderer.on(IPC.SESSION_ACTIVITY, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_ACTIVITY, listener)
    },

    onIntervention: (callback: (sessionId: string, intervention: any) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, intervention: any) => {
        callback(sessionId, intervention)
      }
      ipcRenderer.on(IPC.SESSION_INTERVENTION, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_INTERVENTION, listener)
    },

    onNameChange: (callback: (sessionId: string, name: string) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, name: string) => {
        callback(sessionId, name)
      }
      ipcRenderer.on(IPC.SESSION_NAME_CHANGE, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_NAME_CHANGE, listener)
    },

    // 监听会话列表刷新（远程创建/终止会话时触发）
    onRefresh: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC.SESSION_REFRESH, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_REFRESH, listener)
    },


    // SDK V2: 结构化消息发送
    sendMessage: (sessionId: string, text: string) =>
      ipcRenderer.invoke(IPC.SESSION_SEND_MESSAGE, sessionId, text),

    // SDK V2: 获取对话历史
    getConversation: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_CONVERSATION_HISTORY, sessionId),

    // SDK V2: 中止会话
    abortSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_ABORT, sessionId),

    // SDK V2: 权限响应
    respondPermission: (sessionId: string, accept: boolean) =>
      ipcRenderer.invoke(IPC.SESSION_PERMISSION_RESPOND, sessionId, accept),

    // SDK V2: AskUserQuestion 答案
    answerQuestion: (sessionId: string, answers: Record<string, string>) =>
      ipcRenderer.invoke(IPC.SESSION_ANSWER_QUESTION, sessionId, answers),

    // SDK V2: ExitPlanMode 审批
    approvePlan: (sessionId: string, approved: boolean) =>
      ipcRenderer.invoke(IPC.SESSION_APPROVE_PLAN, sessionId, approved),

    // SDK V2: 获取排队中的消息列表
    getQueue: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_GET_QUEUE, sessionId),

    // SDK V2: 清空排队中的消息（用户主动取消）
    clearQueue: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SESSION_CLEAR_QUEUE, sessionId),

    // SDK V2: iFlow 预热（提前完成握手，发送消息时无需等待初始化）
    prewarm: (config: any) =>
      ipcRenderer.invoke(IPC.SESSION_PREWARM, config),

    // SDK V2: 对话消息事件监听
    onConversationMessage: (callback: (sessionId: string, msg: any) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, msg: any) => {
        callback(sessionId, msg)
      }
      ipcRenderer.on(IPC.SESSION_CONVERSATION_MESSAGE, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_CONVERSATION_MESSAGE, listener)
    },

    // SDK V2: 会话初始化数据事件监听
    onInitData: (callback: (sessionId: string, data: any) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, data: any) => {
        callback(sessionId, data)
      }
      ipcRenderer.on(IPC.SESSION_INIT_DATA, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_INIT_DATA, listener)
    },

    // SDK V2: Provider 需要认证事件监听
    onAuthRequired: (callback: (sessionId: string, data: {
      providerId: string
      message: string
      authCommand: string
      requiredEnvKey?: string
    }) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, data: any) => {
        callback(sessionId, data)
      }
      ipcRenderer.on(IPC.SESSION_AUTH_REQUIRED, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_AUTH_REQUIRED, listener)
    },

    // SDK V2: Token 用量更新事件
    onTokenUpdate: (callback: (sessionId: string, usage: any) => void) => {
      const listener = (_event: IpcRendererEvent, sessionId: string, usage: any) => {
        callback(sessionId, usage)
      }
      ipcRenderer.on(IPC.SESSION_TOKEN_UPDATE, listener)
      return () => ipcRenderer.removeListener(IPC.SESSION_TOKEN_UPDATE, listener)
    }
  },

  // ==================== Task API ====================
  task: {
    create: (task: any) => ipcRenderer.invoke(IPC.TASK_CREATE, task),

    update: (taskId: string, updates: any) =>
      ipcRenderer.invoke(IPC.TASK_UPDATE, taskId, updates),

    delete: (taskId: string) => ipcRenderer.invoke(IPC.TASK_DELETE, taskId),

    getAll: () => ipcRenderer.invoke(IPC.TASK_GET_ALL),

    startSession: (taskId: string, config?: any) =>
      ipcRenderer.invoke(IPC.TASK_START_SESSION, taskId, config),

    onStatusChange: (callback: (taskId: string, updates: any) => void) => {
      const listener = (_event: IpcRendererEvent, taskId: string, updates: any) => {
        callback(taskId, updates)
      }
      ipcRenderer.on(IPC.TASK_STATUS_CHANGE, listener)
      return () => ipcRenderer.removeListener(IPC.TASK_STATUS_CHANGE, listener)
    }
  },


  // ==================== Provider API ====================
  provider: {
    getAll: () => ipcRenderer.invoke(IPC.PROVIDER_GET_ALL),
    get: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_GET, id),
    create: (provider: any) => ipcRenderer.invoke(IPC.PROVIDER_CREATE, provider),
    update: (id: string, updates: any) => ipcRenderer.invoke(IPC.PROVIDER_UPDATE, id, updates),
    delete: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_DELETE, id),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IPC.PROVIDER_REORDER, orderedIds),
    /** 检测 CLI 命令是否已安装，返回 { found: boolean, path: string | null } */
    checkCli: (command: string) => ipcRenderer.invoke(IPC.PROVIDER_CHECK_CLI, command),
    /**
     * 测试 Claude Code 可执行文件是否可用。
     * - 传入 executablePath：验证该路径的文件是否存在
     * - 不传参数：自动检测系统中的 claude CLI
     * 返回 { found: boolean, path: string | null, error?: string }
     */
    testExecutable: (executablePath?: string) => ipcRenderer.invoke(IPC.PROVIDER_TEST_EXECUTABLE, executablePath),
    /** 在系统终端中运行 Provider 认证命令（如 qwen auth） */
    runAuthCli: (command: string, args?: string[]) => ipcRenderer.invoke(IPC.PROVIDER_RUN_AUTH_CLI, command, args),
  },

  // ==================== NVM API ====================
  nvm: {
    listVersions: () => ipcRenderer.invoke(IPC.NVM_LIST_VERSIONS),
  },

  // ==================== Search API ====================
  search: {
    logs: (query: string, sessionId?: string, limit?: number) =>
      ipcRenderer.invoke(IPC.SEARCH_LOGS, query, sessionId, limit)
  },

  // ==================== Usage API ====================
  usage: {
    getSummary: () => ipcRenderer.invoke(IPC.USAGE_GET_SUMMARY),
    getHistory: (days?: number) => ipcRenderer.invoke(IPC.USAGE_GET_HISTORY, days),
    flush: () => ipcRenderer.invoke(IPC.USAGE_FLUSH)
  },

  // Legacy - 保持向后兼容
  getUsageSummary: () => ipcRenderer.invoke(IPC.USAGE_GET_SUMMARY),

  // ==================== Summary API ====================
  summary: {
    // 生成会话摘要（AI 驱动）
    generate: (sessionId: string, options?: {
      type?: 'auto' | 'manual' | 'key_points'
      includeKeyPoints?: boolean
      providerId?: string
      model?: string
    }) => ipcRenderer.invoke(IPC.SUMMARY_GENERATE, sessionId, options),

    // 获取单个摘要
    getSummary: (id: number) =>
      ipcRenderer.invoke(IPC.SUMMARY_GET, id),

    // 获取会话的摘要列表
    listSummaries: (sessionId: string, limit?: number) =>
      ipcRenderer.invoke(IPC.SUMMARY_LIST, sessionId, limit),

    // 获取所有会话的最新摘要
    listAllSummaries: (limit?: number) =>
      ipcRenderer.invoke(IPC.SUMMARY_LIST_ALL, limit),

    // 更新摘要
    updateSummary: (id: number, updates: {
      summary?: string
      keyPoints?: string
      qualityScore?: number
      summaryType?: 'auto' | 'manual' | 'key_points'
    }) => ipcRenderer.invoke(IPC.SUMMARY_UPDATE, id, updates),

    // 删除摘要
    deleteSummary: (id: number) =>
      ipcRenderer.invoke(IPC.SUMMARY_DELETE, id),

    // 获取会话最新摘要（兼容旧接口）
    getLatest: (sessionId: string) =>
      ipcRenderer.invoke('summary:get-latest', sessionId),

    // 获取所有会话摘要（兼容旧接口）
    getAllSessions: (limit?: number) =>
      ipcRenderer.invoke('summary:get-all-sessions', limit),
  },

  // ==================== Agent API ====================
  agent: {
    list: (parentSessionId?: string) =>
      ipcRenderer.invoke('agent:list', parentSessionId),

    cancel: (agentId: string) =>
      ipcRenderer.invoke('agent:cancel', agentId),

    onCreated: (callback: (agentInfo: any) => void) => {
      const listener = (_event: IpcRendererEvent, agentInfo: any) => callback(agentInfo)
      ipcRenderer.on('agent:created', listener)
      return () => ipcRenderer.removeListener('agent:created', listener)
    },

    onStatusChange: (callback: (agentId: string, status: string) => void) => {
      const listener = (_event: IpcRendererEvent, agentId: string, status: string) => callback(agentId, status)
      ipcRenderer.on('agent:status-change', listener)
      return () => ipcRenderer.removeListener('agent:status-change', listener)
    },

    onCompleted: (callback: (agentId: string, result: any) => void) => {
      const listener = (_event: IpcRendererEvent, agentId: string, result: any) => callback(agentId, result)
      ipcRenderer.on('agent:completed', listener)
      return () => ipcRenderer.removeListener('agent:completed', listener)
    }
  },

  // ==================== Shortcut API ====================
  shortcut: {
    onViewMode: (callback: (mode: string) => void) => {
      const listener = (_event: IpcRendererEvent, mode: string) => callback(mode)
      ipcRenderer.on('shortcut:view-mode', listener)
      return () => ipcRenderer.removeListener('shortcut:view-mode', listener)
    },
    onCycleTerminal: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('shortcut:cycle-terminal', listener)
      return () => ipcRenderer.removeListener('shortcut:cycle-terminal', listener)
    },
    onNewSession: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('shortcut:new-session', listener)
      return () => ipcRenderer.removeListener('shortcut:new-session', listener)
    },
    onNewTaskSession: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('shortcut:new-task-session', listener)
      return () => ipcRenderer.removeListener('shortcut:new-task-session', listener)
    },
    onToggleSidebar: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('shortcut:toggle-sidebar', listener)
      return () => ipcRenderer.removeListener('shortcut:toggle-sidebar', listener)
    },
    onSearch: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('shortcut:search', listener)
      return () => ipcRenderer.removeListener('shortcut:search', listener)
    }
  },


  // ==================== Git / Worktree API ====================
  git: {
    isRepo: (dirPath: string) => ipcRenderer.invoke(IPC.GIT_IS_REPO, dirPath),
    getBranches: (repoPath: string) => ipcRenderer.invoke(IPC.GIT_GET_BRANCHES, repoPath),
    getCurrentBranch: (repoPath: string) => ipcRenderer.invoke(IPC.GIT_GET_CURRENT_BRANCH, repoPath),
    detectMainBranch: (repoPath: string) => ipcRenderer.invoke(IPC.GIT_DETECT_MAIN_BRANCH, repoPath),
    getRepoRoot: (dirPath: string) => ipcRenderer.invoke(IPC.GIT_GET_REPO_ROOT, dirPath),
    isDirty: (dirPath: string) => ipcRenderer.invoke(IPC.GIT_IS_DIRTY, dirPath),
    getStatus:    (repoPath: string) => ipcRenderer.invoke(IPC.GIT_GET_STATUS, repoPath),
    getFileDiff:  (repoPath: string, filePath: string, staged?: boolean, commitHash?: string) =>
                    ipcRenderer.invoke(IPC.GIT_GET_FILE_DIFF, repoPath, filePath, staged, commitHash),
    stage:        (repoPath: string, filePaths: string[]) =>
                    ipcRenderer.invoke(IPC.GIT_STAGE, repoPath, filePaths),
    unstage:      (repoPath: string, filePaths: string[]) =>
                    ipcRenderer.invoke(IPC.GIT_UNSTAGE, repoPath, filePaths),
    discard:      (repoPath: string, filePaths: string[]) =>
                    ipcRenderer.invoke(IPC.GIT_DISCARD, repoPath, filePaths),
    stageAll:     (repoPath: string) => ipcRenderer.invoke(IPC.GIT_STAGE_ALL, repoPath),
    commit:       (repoPath: string, message: string) =>
                    ipcRenderer.invoke(IPC.GIT_COMMIT, repoPath, message),
    pull:         (repoPath: string) => ipcRenderer.invoke(IPC.GIT_PULL, repoPath),
    push:         (repoPath: string) => ipcRenderer.invoke(IPC.GIT_PUSH, repoPath),
    getLog:       (repoPath: string, limit?: number) =>
                    ipcRenderer.invoke(IPC.GIT_GET_LOG, repoPath, limit),
    getRemoteStatus: (repoPath: string) =>
                    ipcRenderer.invoke(IPC.GIT_GET_REMOTE_STATUS, repoPath),
    getCommitFiles: (repoPath: string, hash: string) =>
                    ipcRenderer.invoke(IPC.GIT_GET_COMMIT_FILES, repoPath, hash),
  },

  worktree: {
    create: (repoPath: string, branch: string, taskId: string) =>
      ipcRenderer.invoke(IPC.WORKTREE_CREATE, repoPath, branch, taskId),
    remove: (repoPath: string, worktreePath: string, deleteBranch?: boolean, branchName?: string) =>
      ipcRenderer.invoke(IPC.WORKTREE_REMOVE, repoPath, worktreePath, deleteBranch, branchName),
    list: (repoPath: string) =>
      ipcRenderer.invoke(IPC.WORKTREE_LIST, repoPath),
    checkMerge: (repoPath: string, worktreePath: string) =>
      ipcRenderer.invoke(IPC.WORKTREE_CHECK_MERGE, repoPath, worktreePath),
    merge: (repoPath: string, branchName: string, options?: { squash?: boolean; message?: string; cleanup?: boolean }) =>
      ipcRenderer.invoke(IPC.WORKTREE_MERGE, repoPath, branchName, options),
    getDiffSummary: (repoPath: string, worktreePath: string, baseCommit?: string, baseBranch?: string, worktreeBranchHint?: string) =>
      ipcRenderer.invoke(IPC.WORKTREE_DIFF_SUMMARY, repoPath, worktreePath, baseCommit, baseBranch, worktreeBranchHint),
    getFileDiff: (repoPath: string, worktreeBranch: string, filePath: string, baseCommit?: string, baseBranch?: string) =>
      ipcRenderer.invoke(IPC.WORKTREE_FILE_DIFF, repoPath, worktreeBranch, filePath, baseCommit, baseBranch),
  },

  // ==================== Workspace API ====================
  workspace: {
    list: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.WORKSPACE_GET, id),
    create: (data: any) => ipcRenderer.invoke(IPC.WORKSPACE_CREATE, data),
    update: (id: string, data: any) => ipcRenderer.invoke(IPC.WORKSPACE_UPDATE, id, data),
    delete: (id: string) => ipcRenderer.invoke(IPC.WORKSPACE_DELETE, id),
    scanRepos: (dirPath: string) => ipcRenderer.invoke(IPC.WORKSPACE_SCAN_REPOS, dirPath),
    importVscode: (filePath: string) => ipcRenderer.invoke(IPC.WORKSPACE_IMPORT_VSCODE, filePath),
  },


  // ==================== File Manager API ====================
  fileManager: {
    listDir: (path: string) => ipcRenderer.invoke('file-manager:list-dir', { path }),
    openPath: (path: string) => ipcRenderer.invoke('file-manager:open-path', path),
    readFile: (path: string) => ipcRenderer.invoke('file-manager:read-file', path),
    watchDir: (path: string) => ipcRenderer.invoke('file-manager:watch-dir', path),
    unwatchDir: (path: string) => ipcRenderer.invoke('file-manager:unwatch-dir', path),
    writeFile: (path: string, content: string) =>
      ipcRenderer.invoke('file-manager:write-file', { path, content }),
    onWatchChange: (callback: (event: any) => void) => {
      const handler = (_: IpcRendererEvent, event: any) => callback(event)
      ipcRenderer.on('file-manager:watch-change', handler)
      return () => ipcRenderer.removeListener('file-manager:watch-change', handler)
    },
    getSessionFiles: (sessionId: string) =>
      ipcRenderer.invoke('file-manager:get-session-files', sessionId),
    onSessionFilesUpdated: (callback: (data: { sessionId: string; files: any[] }) => void) => {
      const handler = (_: IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('file-manager:session-files-updated', handler)
      return () => ipcRenderer.removeListener('file-manager:session-files-updated', handler)
    },
    /** 递归列举项目目录下的所有文件，用于 @ 符号文件引用 */
    listProjectFiles: (dirPath: string, maxResults?: number) =>
      ipcRenderer.invoke('file-manager:list-project-files', dirPath, maxResults),
    getDiff: (filePath: string) =>
      ipcRenderer.invoke('file-manager:get-file-diff', filePath),
    /** 创建空文件 */
    createFile: (filePath: string) =>
      ipcRenderer.invoke('file-manager:create-file', filePath),
    /** 创建目录 */
    createDir: (dirPath: string) =>
      ipcRenderer.invoke('file-manager:create-dir', dirPath),
    /** 重命名文件/目录 */
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('file-manager:rename', { oldPath, newPath }),
    /** 删除文件/目录（移动到回收站） */
    delete: (targetPath: string) =>
      ipcRenderer.invoke('file-manager:delete', targetPath),
    /** 在系统文件管理器中显示 */
    showInFolder: (filePath: string) =>
      ipcRenderer.invoke('file-manager:show-in-folder', filePath),
  },

  // ==================== MCP API ====================
  mcp: {
    getAll: () => ipcRenderer.invoke(IPC.MCP_GET_ALL),
    get: (id: string) => ipcRenderer.invoke(IPC.MCP_GET, id),
    create: (server: any) => ipcRenderer.invoke(IPC.MCP_CREATE, server),
    update: (id: string, updates: any) => ipcRenderer.invoke(IPC.MCP_UPDATE, id, updates),
    delete: (id: string) => ipcRenderer.invoke(IPC.MCP_DELETE, id),
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.MCP_TOGGLE, id, enabled),
    testConnection: (id: string) => ipcRenderer.invoke(IPC.MCP_TEST_CONNECTION, id),
    getForProvider: (providerId: string) => ipcRenderer.invoke(IPC.MCP_GET_FOR_PROVIDER, providerId),
    // Stream A: MCP 一键安装
    install: (id: string) => ipcRenderer.invoke(IPC.MCP_INSTALL, id),
    onInstallProgress: (cb: (data: { id: string; line: string; type: string }) => void) => {
      ipcRenderer.on(IPC.MCP_INSTALL_PROGRESS, (_e, data) => cb(data))
    },
  },

  // ==================== Skill API ====================
  skill: {
    getAll: () => ipcRenderer.invoke(IPC.SKILL_GET_ALL),
    get: (id: string) => ipcRenderer.invoke(IPC.SKILL_GET, id),
    create: (skill: any) => ipcRenderer.invoke(IPC.SKILL_CREATE, skill),
    update: (id: string, updates: any) => ipcRenderer.invoke(IPC.SKILL_UPDATE, id, updates),
    delete: (id: string) => ipcRenderer.invoke(IPC.SKILL_DELETE, id),
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.SKILL_TOGGLE, id, enabled),
    getByCommand: (command: string) => ipcRenderer.invoke(IPC.SKILL_GET_BY_COMMAND, command),
    /** 监听 MCP install_skill 安装新技能的通知，返回取消监听函数 */
    onInstalled: (callback: (skill: any) => void) => {
      const listener = (_event: IpcRendererEvent, skill: any) => callback(skill)
      ipcRenderer.on(IPC.SKILL_INSTALLED_NOTIFY, listener)
      return () => ipcRenderer.removeListener(IPC.SKILL_INSTALLED_NOTIFY, listener)
    },
  },

  // ==================== Registry API（在线市场）====================
  registry: {
    fetchMcps: () => ipcRenderer.invoke(IPC.REGISTRY_FETCH_MCPS),
    fetchSkills: (forceRefresh?: boolean) => ipcRenderer.invoke(IPC.REGISTRY_FETCH_SKILLS, forceRefresh),
    forceRefresh: () => ipcRenderer.invoke(IPC.REGISTRY_FORCE_REFRESH),
    importSkillFromUrl: (url: string) => ipcRenderer.invoke(IPC.SKILL_IMPORT_URL, url),
    getSources: () => ipcRenderer.invoke(IPC.REGISTRY_GET_SOURCES),
    fetchSkillsFromSource: (sourceId: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke(IPC.REGISTRY_FETCH_SKILLS_FROM_SOURCE, sourceId, forceRefresh),
    fetchTrending: (platform?: string) =>
      ipcRenderer.invoke(IPC.REGISTRY_FETCH_TRENDING, platform),
  },

  // ==================== Agent Teams API ====================
  team: {
    create: (request: any) => ipcRenderer.invoke(IPC.TEAM_CREATE, request),
    getAll: (status?: string) => ipcRenderer.invoke(IPC.TEAM_GET_ALL, status),
    get: (teamId: string) => ipcRenderer.invoke(IPC.TEAM_GET, teamId),
    getTasks: (teamId: string, status?: string) => ipcRenderer.invoke(IPC.TEAM_GET_TASKS, teamId, status),
    getMessages: (teamId: string, limit?: number) => ipcRenderer.invoke(IPC.TEAM_GET_MESSAGES, teamId, limit),
    createTask: (teamId: string, task: any) => ipcRenderer.invoke(IPC.TEAM_CREATE_TASK, teamId, task),
    completeTask: (teamId: string, taskId: string, result: string) => ipcRenderer.invoke(IPC.TEAM_COMPLETE_TASK, teamId, taskId, result),
    updateTask: (teamId: string, taskId: string, updates: any) => ipcRenderer.invoke(IPC.TEAM_UPDATE_TASK, teamId, taskId, updates),
    cancelTask: (teamId: string, taskId: string, reason?: string) => ipcRenderer.invoke(IPC.TEAM_CANCEL_TASK, teamId, taskId, reason),
    reassignTask: (teamId: string, taskId: string, newMemberId: string) => ipcRenderer.invoke(IPC.TEAM_REASSIGN_TASK, teamId, taskId, newMemberId),
    getTemplates: () => ipcRenderer.invoke(IPC.TEAM_GET_TEMPLATES),
    createTemplate: (template: any) => ipcRenderer.invoke(IPC.TEAM_CREATE_TEMPLATE, template),
    updateTemplate: (templateId: string, updates: any) => ipcRenderer.invoke(IPC.TEAM_UPDATE_TEMPLATE, templateId, updates),
    deleteTemplate: (templateId: string) => ipcRenderer.invoke(IPC.TEAM_DELETE_TEMPLATE, templateId),
    getHealth: (teamId: string) => ipcRenderer.invoke('team:get-health', teamId),
    cleanup: (teamId: string) => ipcRenderer.invoke('team:cleanup', teamId),
    cancel: (teamId: string, reason?: string) => ipcRenderer.invoke(IPC.TEAM_CANCEL, teamId, reason),
    pause: (teamId: string) => ipcRenderer.invoke(IPC.TEAM_PAUSE, teamId),
    resume: (teamId: string) => ipcRenderer.invoke(IPC.TEAM_RESUME, teamId),
    update: (teamId: string, updates: any) => ipcRenderer.invoke(IPC.TEAM_UPDATE, teamId, updates),
    sendMessage: (teamId: string, toMemberId: string, content: string) => ipcRenderer.invoke(IPC.TEAM_SEND_MESSAGE, teamId, toMemberId, content),
    broadcast: (teamId: string, content: string) => ipcRenderer.invoke(IPC.TEAM_UI_BROADCAST, teamId, content),
    getTaskDAG: (teamId: string) => ipcRenderer.invoke(IPC.TEAM_GET_TASK_DAG, teamId),
    validateDependencies: (teamId: string) => ipcRenderer.invoke(IPC.TEAM_VALIDATE_DEPENDENCIES, teamId),
    exportTeam: (teamId: string) => ipcRenderer.invoke(IPC.TEAM_EXPORT, teamId),
    importTeam: (snapshot: any) => ipcRenderer.invoke(IPC.TEAM_IMPORT, snapshot),
    mergeWorktrees: (teamId: string, options?: any) => ipcRenderer.invoke(IPC.TEAM_MERGE_WORKTREES, teamId, options),
    // 事件监听
    onStatusChange: (callback: (teamId: string, status: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, status: string) => callback(teamId, status)
      ipcRenderer.on(IPC.TEAM_STATUS_CHANGE, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_STATUS_CHANGE, listener)
    },
    onMemberJoined: (callback: (teamId: string, member: any) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, member: any) => callback(teamId, member)
      ipcRenderer.on(IPC.TEAM_MEMBER_JOINED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_MEMBER_JOINED, listener)
    },
    onMemberStatusChange: (callback: (teamId: string, memberId: string, status: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, memberId: string, status: string) => callback(teamId, memberId, status)
      ipcRenderer.on(IPC.TEAM_MEMBER_STATUS_CHANGE, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_MEMBER_STATUS_CHANGE, listener)
    },
    onTaskClaimed: (callback: (teamId: string, taskId: string, memberId: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, taskId: string, memberId: string) => callback(teamId, taskId, memberId)
      ipcRenderer.on(IPC.TEAM_TASK_CLAIMED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_TASK_CLAIMED, listener)
    },
    onTaskCompleted: (callback: (teamId: string, taskId: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, taskId: string) => callback(teamId, taskId)
      ipcRenderer.on(IPC.TEAM_TASK_COMPLETED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_TASK_COMPLETED, listener)
    },
    onTaskCancelled: (callback: (teamId: string, taskId: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, taskId: string) => callback(teamId, taskId)
      ipcRenderer.on(IPC.TEAM_TASK_CANCELLED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_TASK_CANCELLED, listener)
    },
    onMessage: (callback: (teamId: string, message: any) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, message: any) => callback(teamId, message)
      ipcRenderer.on(IPC.TEAM_MESSAGE, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_MESSAGE, listener)
    },
    onCompleted: (callback: (teamId: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string) => callback(teamId)
      ipcRenderer.on(IPC.TEAM_COMPLETED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_COMPLETED, listener)
    },
    onFailed: (callback: (teamId: string, reason: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, reason: string) => callback(teamId, reason)
      ipcRenderer.on(IPC.TEAM_FAILED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_FAILED, listener)
    },
    onCancelled: (callback: (teamId: string, reason: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, reason: string) => callback(teamId, reason)
      ipcRenderer.on(IPC.TEAM_CANCELLED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_CANCELLED, listener)
    },
    onPaused: (callback: (teamId: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string) => callback(teamId)
      ipcRenderer.on(IPC.TEAM_PAUSED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_PAUSED, listener)
    },
    onResumed: (callback: (teamId: string) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string) => callback(teamId)
      ipcRenderer.on(IPC.TEAM_RESUMED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_RESUMED, listener)
    },
    onUpdated: (callback: (teamId: string, updates: any) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, updates: any) => callback(teamId, updates)
      ipcRenderer.on(IPC.TEAM_UPDATED, listener)
      return () => ipcRenderer.removeListener(IPC.TEAM_UPDATED, listener)
    },
    onHealthIssue: (callback: (teamId: string, issue: any) => void) => {
      const listener = (_e: IpcRendererEvent, teamId: string, issue: any) => callback(teamId, issue)
      ipcRenderer.on('team:health-issue', listener)
      return () => ipcRenderer.removeListener('team:health-issue', listener)
    },
    onLog: (callback: (entry: any) => void) => {
      const listener = (_e: IpcRendererEvent, entry: any) => callback(entry)
      ipcRenderer.on('team:log', listener)
      return () => ipcRenderer.removeListener('team:log', listener)
    },
  },

  // ==================== Telegram API ====================
  telegram: {
    getConfig: () => ipcRenderer.invoke(IPC.TELEGRAM_GET_CONFIG),
    setConfig: (config: any) => ipcRenderer.invoke(IPC.TELEGRAM_SET_CONFIG, config),
    deleteConfig: () => ipcRenderer.invoke(IPC.TELEGRAM_DELETE_CONFIG),
    getStatus: () => ipcRenderer.invoke(IPC.TELEGRAM_GET_STATUS),
    testConnection: (token: string) => ipcRenderer.invoke(IPC.TELEGRAM_TEST_CONNECTION, token),
    getMappings: () => ipcRenderer.invoke(IPC.TELEGRAM_GET_MAPPINGS),
    addMapping: (mapping: any) => ipcRenderer.invoke(IPC.TELEGRAM_ADD_MAPPING, mapping),
    removeMapping: (id: string) => ipcRenderer.invoke(IPC.TELEGRAM_REMOVE_MAPPING, id),
    onStatusChanged: (callback: (status: string) => void) => {
      ipcRenderer.on(IPC.TELEGRAM_STATUS_CHANGED, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.TELEGRAM_STATUS_CHANGED, () => {})
    },
    onMessageSent: (callback: (chatId: string, msg: string) => void) => {
      ipcRenderer.on(IPC.TELEGRAM_MESSAGE_SENT, (_e, chatId, msg) => callback(chatId, msg))
      return () => ipcRenderer.removeListener(IPC.TELEGRAM_MESSAGE_SENT, () => {})
    },
  },

  // ==================== Feishu API ====================
  feishu: {
    getConfig: () => ipcRenderer.invoke(IPC.FEISHU_GET_CONFIG),
    setConfig: (config: any) => ipcRenderer.invoke(IPC.FEISHU_SET_CONFIG, config),
    deleteConfig: () => ipcRenderer.invoke(IPC.FEISHU_DELETE_CONFIG),
    getStatus: () => ipcRenderer.invoke(IPC.FEISHU_GET_STATUS),
    testConnection: (config: any) => ipcRenderer.invoke(IPC.FEISHU_TEST_CONNECTION, config),
    getMappings: () => ipcRenderer.invoke(IPC.FEISHU_GET_MAPPINGS),
    addMapping: (mapping: any) => ipcRenderer.invoke(IPC.FEISHU_ADD_MAPPING, mapping),
    removeMapping: (id: string) => ipcRenderer.invoke(IPC.FEISHU_REMOVE_MAPPING, id),
    onStatusChanged: (callback: (status: string) => void) => {
      ipcRenderer.on(IPC.FEISHU_STATUS_CHANGED, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.FEISHU_STATUS_CHANGED, () => {})
    },
  },

  // ==================== Scheduler API ====================
  scheduler: {
    getTasks: () => ipcRenderer.invoke(IPC.SCHEDULER_GET_TASKS),
    getTask: (taskId: string) => ipcRenderer.invoke(IPC.SCHEDULER_GET_TASK, taskId),
    createTask: (data: any) => ipcRenderer.invoke(IPC.SCHEDULER_CREATE_TASK, data),
    updateTask: (taskId: string, updates: any) => ipcRenderer.invoke(IPC.SCHEDULER_UPDATE_TASK, taskId, updates),
    deleteTask: (taskId: string) => ipcRenderer.invoke(IPC.SCHEDULER_DELETE_TASK, taskId),
    triggerRun: (taskId: string) => ipcRenderer.invoke(IPC.SCHEDULER_TRIGGER_RUN, taskId),
    getRuns: (taskId: string, limit?: number) => ipcRenderer.invoke(IPC.SCHEDULER_GET_RUNS, taskId, limit),
    getRecentRuns: (limit?: number) => ipcRenderer.invoke(IPC.SCHEDULER_GET_RECENT_RUNS, limit),
    validateCron: (expression: string) => ipcRenderer.invoke('scheduler:validate-cron', expression),
    onTaskStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.SCHEDULER_TASK_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.SCHEDULER_TASK_STATUS, () => {})
    },
  },

  // ==================== Planner API ====================
  planner: {
    list: () => ipcRenderer.invoke(IPC.PLAN_LIST),
    get: (planId: string) => ipcRenderer.invoke(IPC.PLAN_GET, planId),
    create: (data: any) => ipcRenderer.invoke(IPC.PLAN_CREATE, data),
    update: (planId: string, updates: any) => ipcRenderer.invoke(IPC.PLAN_UPDATE, planId, updates),
    delete: (planId: string) => ipcRenderer.invoke(IPC.PLAN_DELETE, planId),
    start: (planId: string, sessionId: string) => ipcRenderer.invoke(IPC.PLAN_START, planId, sessionId),
    getTasks: (planId: string) => ipcRenderer.invoke('plan:get-tasks', planId),
    getSteps: (taskId: string) => ipcRenderer.invoke(IPC.PLAN_GET_STEPS, taskId),
    executeStep: (stepId: string, sessionId: string, providerId?: string) =>
      ipcRenderer.invoke(IPC.PLAN_STEP_EXECUTE, stepId, sessionId, providerId),
    updateStep: (stepId: string, updates: any) => ipcRenderer.invoke(IPC.PLAN_STEP_UPDATE, stepId, updates),
    skipTask: (taskId: string) => ipcRenderer.invoke('plan:skip-task', taskId),
    skipStep: (stepId: string) => ipcRenderer.invoke('plan:skip-step', stepId),
    getStatus: () => ipcRenderer.invoke(IPC.PLAN_STATUS),
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.PLAN_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.PLAN_STATUS, () => {})
    },
  },

  // ==================== Workflow API ====================
  workflow: {
    list: () => ipcRenderer.invoke(IPC.WORKFLOW_LIST),
    get: (workflowId: string) => ipcRenderer.invoke(IPC.WORKFLOW_GET, workflowId),
    create: (data: any) => ipcRenderer.invoke(IPC.WORKFLOW_CREATE, data),
    update: (workflowId: string, updates: any) => ipcRenderer.invoke(IPC.WORKFLOW_UPDATE, workflowId, updates),
    delete: (workflowId: string) => ipcRenderer.invoke(IPC.WORKFLOW_DELETE, workflowId),
    execute: (workflowId: string, triggerBy?: string, context?: any) =>
      ipcRenderer.invoke(IPC.WORKFLOW_EXECUTE, workflowId, triggerBy, context),
    pause: (executionId: string) => ipcRenderer.invoke(IPC.WORKFLOW_PAUSE, executionId),
    resume: (executionId: string) => ipcRenderer.invoke(IPC.WORKFLOW_RESUME, executionId),
    getRuns: (executionId: string) => ipcRenderer.invoke(IPC.WORKFLOW_GET_RUNS, executionId),
    getExecution: (executionId: string) => ipcRenderer.invoke(IPC.WORKFLOW_GET_EXECUTION, executionId),
    getExecutions: (workflowId: string, limit?: number) => ipcRenderer.invoke(IPC.WORKFLOW_GET_EXECUTIONS, workflowId, limit),
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.WORKFLOW_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.WORKFLOW_STATUS, () => {})
    },
  },

  // ==================== Evaluation API ====================
  evaluation: {
    createTemplate: (data: any) => ipcRenderer.invoke(IPC.EVAL_CREATE_TEMPLATE, data),
    listTemplates: () => ipcRenderer.invoke(IPC.EVAL_LIST_TEMPLATES),
    getTemplate: (templateId: string) => ipcRenderer.invoke(IPC.EVAL_GET_TEMPLATE, templateId),
    updateTemplate: (templateId: string, updates: any) => ipcRenderer.invoke(IPC.EVAL_UPDATE_TEMPLATE, templateId, updates),
    deleteTemplate: (templateId: string) => ipcRenderer.invoke(IPC.EVAL_DELETE_TEMPLATE, templateId),
    startRun: (sessionId: string, templateId: string) => ipcRenderer.invoke(IPC.EVAL_RUN_START, sessionId, templateId),
    listRuns: (limit?: number) => ipcRenderer.invoke(IPC.EVAL_LIST_RUNS, limit),
    getRun: (runId: string) => ipcRenderer.invoke(IPC.EVAL_GET_RUN, runId),
    getResults: (runId: string) => ipcRenderer.invoke(IPC.EVAL_GET_RESULTS, runId),
    onRunStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.EVAL_RUN_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.EVAL_RUN_STATUS, () => {})
    },
  },

  // ==================== Goal API ====================
  goal: {
    create: (data: any) => ipcRenderer.invoke(IPC.GOAL_CREATE, data),
    list: (status?: string) => ipcRenderer.invoke(IPC.GOAL_LIST, status),
    get: (goalId: string) => ipcRenderer.invoke(IPC.GOAL_GET, goalId),
    update: (goalId: string, updates: any) => ipcRenderer.invoke(IPC.GOAL_UPDATE, goalId, updates),
    delete: (goalId: string) => ipcRenderer.invoke(IPC.GOAL_DELETE, goalId),
    addActivity: (data: any) => ipcRenderer.invoke(IPC.GOAL_ADD_ACTIVITY, data),
    getActivities: (goalId: string, limit?: number) => ipcRenderer.invoke(IPC.GOAL_GET_ACTIVITIES, goalId, limit),
    linkSession: (goalId: string, sessionId: string, isPrimary?: boolean) =>
      ipcRenderer.invoke(IPC.GOAL_LINK_SESSION, goalId, sessionId, isPrimary),
    getSessions: (goalId: string) => ipcRenderer.invoke(IPC.GOAL_GET_SESSIONS, goalId),
    getStats: () => ipcRenderer.invoke(IPC.GOAL_GET_STATS),
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.GOAL_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.GOAL_STATUS, () => {})
    },
  },

  // ==================== Prompt Optimizer API ====================
  promptOptimizer: {
    // Template CRUD
    createTemplate: (data: any) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATE_CREATE, data),
    listTemplates: (category?: string) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATE_LIST, category),
    getTemplate: (id: string) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATE_GET, id),
    updateTemplate: (id: string, updates: any) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATE_UPDATE, id, updates),
    deleteTemplate: (id: string) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATE_DELETE, id),
    // Version management
    createVersion: (data: any) => ipcRenderer.invoke(IPC.PROMPT_VERSION_CREATE, data),
    listVersions: (templateId: string) => ipcRenderer.invoke(IPC.PROMPT_VERSION_LIST, templateId),
    updateVersion: (id: string, updates: any) => ipcRenderer.invoke(IPC.PROMPT_VERSION_UPDATE, id, updates),
    setBaseline: (versionId: string) => ipcRenderer.invoke(IPC.PROMPT_VERSION_SET_BASELINE, versionId),
    deleteVersion: (id: string) => ipcRenderer.invoke(IPC.PROMPT_VERSION_DELETE, id),
    // Testing
    runTest: (versionId: string, testInput: string, providerId?: string) =>
      ipcRenderer.invoke(IPC.PROMPT_RUN_TEST, versionId, testInput, providerId),
    compare: (versionId1: string, versionId2: string, testInput: string) =>
      ipcRenderer.invoke(IPC.PROMPT_COMPARE, versionId1, versionId2, testInput),
    listTests: (versionId: string, limit?: number) =>
      ipcRenderer.invoke(IPC.PROMPT_TEST_LIST, versionId, limit),
    getTestStats: (versionId: string) => ipcRenderer.invoke(IPC.PROMPT_TEST_GET_STATS, versionId),
    // Optimization (Advanced)
    optimizeAuto: (templateId: string, targetVersionId: string) =>
      ipcRenderer.invoke(IPC.PROMPT_OPTIMIZE_AUTO, templateId, targetVersionId),
    optimizeWithHints: (templateId: string, targetVersionId: string, hints: string) =>
      ipcRenderer.invoke(IPC.PROMPT_OPTIMIZE_HINTS, templateId, targetVersionId, hints),
    getOptimizationRun: (runId: string) =>
      ipcRenderer.invoke(IPC.PROMPT_OPTIMIZATION_GET_RUN, runId),
    listOptimizationRuns: (templateId?: string, limit?: number) =>
      ipcRenderer.invoke(IPC.PROMPT_OPTIMIZATION_LIST_RUNS, templateId, limit),
    getFeedback: (runId: string) =>
      ipcRenderer.invoke(IPC.PROMPT_OPTIMIZATION_GET_FEEDBACK, runId),
    getBestVersion: (templateId: string) =>
      ipcRenderer.invoke(IPC.PROMPT_GET_BEST_VERSION, templateId),
    promoteBest: (templateId: string) =>
      ipcRenderer.invoke(IPC.PROMPT_PROMOTE_BEST, templateId),
    getEvolution: (templateId: string) =>
      ipcRenderer.invoke(IPC.PROMPT_GET_EVOLUTION, templateId),
    // Events
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.PROMPT_OPTIMIZATION_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.PROMPT_OPTIMIZATION_STATUS, () => {})
    },
  },

  // ==================== Analyzer API ====================
  analyzer: {
    startAnalysis: (config: any) => ipcRenderer.invoke(IPC.ANALYZER_START, config),
    getReport: (reportId: string) => ipcRenderer.invoke(IPC.ANALYZER_GET_REPORT, reportId),
    getAllReports: () => ipcRenderer.invoke(IPC.ANALYZER_GET_ALL_REPORTS),
  },

  // ==================== Working Context API ====================
  workingContext: {
    get: (sessionId: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_GET, sessionId),
    updateTask: (sessionId: string, task: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_UPDATE_TASK, sessionId, task),
    addProblem: (sessionId: string, content: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_ADD_PROBLEM, sessionId, content),
    resolveProblem: (sessionId: string, problemId: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_RESOLVE_PROBLEM, sessionId, problemId),
    addDecision: (sessionId: string, content: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_ADD_DECISION, sessionId, content),
    addTodo: (sessionId: string, content: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_ADD_TODO, sessionId, content),
    resolveTodo: (sessionId: string, todoId: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_RESOLVE_TODO, sessionId, todoId),
    addSnippet: (sessionId: string, snippet: any) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_ADD_SNIPPET, sessionId, snippet),
    removeItem: (sessionId: string, category: string, itemId: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_REMOVE_ITEM, sessionId, category, itemId),
    createSnapshot: (sessionId: string, trigger?: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_CREATE_SNAPSHOT, sessionId, trigger),
    getPrompt: (sessionId: string) => ipcRenderer.invoke(IPC.WORKING_CONTEXT_GET_PROMPT, sessionId),
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.WORKING_CONTEXT_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.WORKING_CONTEXT_STATUS, () => {})
    },
  },

  // ==================== Drift Guard API ====================
  driftGuard: {
    start: (sessionId: string, goalId: string) => ipcRenderer.invoke(IPC.DRIFT_GUARD_START, sessionId, goalId),
    stop: (sessionId: string) => ipcRenderer.invoke(IPC.DRIFT_GUARD_STOP, sessionId),
    getState: (sessionId: string) => ipcRenderer.invoke(IPC.DRIFT_GUARD_GET_STATE, sessionId),
    resume: (sessionId: string) => ipcRenderer.invoke(IPC.DRIFT_GUARD_RESUME, sessionId),
    getPrompt: (sessionId: string) => ipcRenderer.invoke(IPC.DRIFT_GUARD_GET_PROMPT, sessionId),
    updateConfig: (updates: any) => ipcRenderer.invoke(IPC.DRIFT_GUARD_UPDATE_CONFIG, updates),
    getConfig: () => ipcRenderer.invoke(IPC.DRIFT_GUARD_GET_CONFIG),
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.DRIFT_GUARD_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.DRIFT_GUARD_STATUS, () => {})
    },
  },

  // ==================== Cross Session Memory API ====================
  crossMemory: {
    search: (query: string, limit?: number) => ipcRenderer.invoke(IPC.CROSS_MEMORY_SEARCH, query, limit),
    list: (limit?: number) => ipcRenderer.invoke(IPC.CROSS_MEMORY_LIST, limit),
    index: (sessionId: string, sessionName: string, summary: string, keyPoints: string) =>
      ipcRenderer.invoke(IPC.CROSS_MEMORY_INDEX, sessionId, sessionName, summary, keyPoints),
    delete: (id: string) => ipcRenderer.invoke(IPC.CROSS_MEMORY_DELETE, id),
    getPrompt: (sessionGoal: string) => ipcRenderer.invoke(IPC.CROSS_MEMORY_GET_PROMPT, sessionGoal),
    getStats: () => ipcRenderer.invoke(IPC.CROSS_MEMORY_GET_STATS),
    updateConfig: (updates: any) => ipcRenderer.invoke(IPC.CROSS_MEMORY_UPDATE_CONFIG, updates),
  },

  // ==================== Session Template API ====================
  sessionTemplate: {
    list: (category?: string) => ipcRenderer.invoke(IPC.SESSION_TEMPLATE_LIST, category),
    get: (id: string) => ipcRenderer.invoke(IPC.SESSION_TEMPLATE_GET, id),
    create: (data: any) => ipcRenderer.invoke(IPC.SESSION_TEMPLATE_CREATE, data),
    update: (id: string, updates: any) => ipcRenderer.invoke(IPC.SESSION_TEMPLATE_UPDATE, id, updates),
    delete: (id: string) => ipcRenderer.invoke(IPC.SESSION_TEMPLATE_DELETE, id),
    getCategories: () => ipcRenderer.invoke(IPC.SESSION_TEMPLATE_GET_CATEGORIES),
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on(IPC.SESSION_TEMPLATE_STATUS, (_e, status) => callback(status))
      return () => ipcRenderer.removeListener(IPC.SESSION_TEMPLATE_STATUS, () => {})
    },
  },

  // ==================== Code Context Injection API ====================
  codeContext: {
    inject: (request: any) => ipcRenderer.invoke(IPC.CODE_CONTEXT_INJECT, request),
    getModes: () => ipcRenderer.invoke(IPC.CODE_CONTEXT_GET_MODES),
  },

  // ==================== OpenAI Compatible API ====================
  openAICompat: {
    test: (config: any) => ipcRenderer.invoke(IPC.OPENAI_COMPAT_TEST, config),
    create: (config: any) => ipcRenderer.invoke(IPC.OPENAI_COMPAT_CREATE, config),
  },

  // ==================== Checkpoint API ====================
  checkpoint: {
    create: (params: any) => ipcRenderer.invoke(IPC.CHECKPOINT_CREATE, params),
    list: (sessionId: string, limit?: number) => ipcRenderer.invoke(IPC.CHECKPOINT_LIST, sessionId, limit),
    get: (id: string) => ipcRenderer.invoke(IPC.CHECKPOINT_GET, id),
    restore: (id: string) => ipcRenderer.invoke(IPC.CHECKPOINT_RESTORE, id),
    delete: (id: string) => ipcRenderer.invoke(IPC.CHECKPOINT_DELETE, id),
    diff: (fromId: string, toId: string) => ipcRenderer.invoke(IPC.CHECKPOINT_DIFF, fromId, toId),
    autoCreate: (sid: string, name: string, path: string, reason: string, trigger?: string) => ipcRenderer.invoke(IPC.CHECKPOINT_AUTO_CREATE, sid, name, path, reason, trigger),
    getPrompt: () => ipcRenderer.invoke(IPC.CHECKPOINT_GET_PROMPT),
    settings: (updates?: { autoEnabled?: boolean }) => ipcRenderer.invoke(IPC.CHECKPOINT_SETTINGS, updates),
    // 监听新快照创建通知
    onCreated: (callback: (sessionId: string, checkpoint: any) => void) => {
      const handler = (_: any, sessionId: string, checkpoint: any) => callback(sessionId, checkpoint)
      ipcRenderer.on(IPC.CHECKPOINT_CREATED, handler)
      return () => ipcRenderer.removeListener(IPC.CHECKPOINT_CREATED, handler)
    },
  },

  // ==================== Cost Dashboard API ====================
  cost: {
    getSummary: (days?: number) => ipcRenderer.invoke(IPC.COST_GET_SUMMARY, days),
    getHistory: (days?: number) => ipcRenderer.invoke(IPC.COST_GET_HISTORY, days),
    getBySession: (sessionId: string) => ipcRenderer.invoke(IPC.COST_GET_BY_SESSION, sessionId),
    getByProvider: () => ipcRenderer.invoke(IPC.COST_GET_BY_PROVIDER),
    setBudget: (config: any) => ipcRenderer.invoke(IPC.COST_SET_BUDGET, config),
    getBudget: () => ipcRenderer.invoke(IPC.COST_GET_BUDGET),
    getPricing: () => ipcRenderer.invoke(IPC.COST_GET_PRICING),
    updatePricing: (tiers: any[]) => ipcRenderer.invoke(IPC.COST_UPDATE_PRICING, tiers),
    // 监听预算告警
    onBudgetAlert: (callback: (result: { exceeded: boolean; level: string; message: string }) => void) => {
      const handler = (_: any, result: any) => callback(result)
      ipcRenderer.on(IPC.COST_BUDGET_ALERT, handler)
      return () => ipcRenderer.removeListener(IPC.COST_BUDGET_ALERT, handler)
    },
  },

  // ==================== Project Knowledge API ====================
  projectKnowledge: {
    create: (params: any) => ipcRenderer.invoke(IPC.PROJECT_KB_CREATE, params),
    get: (id: string) => ipcRenderer.invoke(IPC.PROJECT_KB_GET, id),
    update: (id: string, updates: any) => ipcRenderer.invoke(IPC.PROJECT_KB_UPDATE, id, updates),
    delete: (id: string) => ipcRenderer.invoke(IPC.PROJECT_KB_DELETE, id),
    list: (projectPath: string, options?: { page?: number; pageSize?: number }) => ipcRenderer.invoke(IPC.PROJECT_KB_LIST, projectPath, options),
    search: (projectPath: string, query: string, limit?: number) => ipcRenderer.invoke(IPC.PROJECT_KB_SEARCH, projectPath, query, limit),
    getPrompt: (projectPath: string) => ipcRenderer.invoke(IPC.PROJECT_KB_GET_PROMPT, projectPath),
    autoExtract: (projectPath: string) => ipcRenderer.invoke(IPC.PROJECT_KB_AUTO_EXTRACT, projectPath),
    deleteBatch: (ids: string[]) => ipcRenderer.invoke(IPC.PROJECT_KB_DELETE_BATCH, ids),
    updateBatch: (ids: string[], updates: any) => ipcRenderer.invoke(IPC.PROJECT_KB_UPDATE_BATCH, ids, updates),
    export: (projectPath: string) => ipcRenderer.invoke(IPC.PROJECT_KB_EXPORT, projectPath),
    import: (projectPath: string, data: any) => ipcRenderer.invoke(IPC.PROJECT_KB_IMPORT, projectPath, data),
  },

  // ==================== Code Review API ====================
  codeReview: {
    start: (params: any) => ipcRenderer.invoke(IPC.CODE_REVIEW_START, params),
    get: (id: string) => ipcRenderer.invoke(IPC.CODE_REVIEW_GET, id),
    list: (sessionId?: string, limit?: number) => ipcRenderer.invoke(IPC.CODE_REVIEW_LIST, sessionId, limit),
    getComments: (reviewId: string) => ipcRenderer.invoke(IPC.CODE_REVIEW_GET_COMMENTS, reviewId),
    resolveComment: (commentId: string) => ipcRenderer.invoke(IPC.CODE_REVIEW_RESOLVE_COMMENT, commentId),
    applyFix: (commentId: string) => ipcRenderer.invoke(IPC.CODE_REVIEW_APPLY_FIX, commentId),
    getPrompt: () => ipcRenderer.invoke(IPC.CODE_REVIEW_GET_PROMPT),
    getStatus: () => ipcRenderer.invoke(IPC.CODE_REVIEW_STATUS),
    settings: (updates?: { autoReviewEnabled?: boolean; autoReviewInterval?: number }) =>
      ipcRenderer.invoke(IPC.CODE_REVIEW_SETTINGS, updates),
    // 监听审查完成通知
    onCompleted: (callback: (data: { reviewId: string; status: string; summary: string; score: number; totalComments: number }) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on(IPC.CODE_REVIEW_COMPLETED, handler)
      return () => ipcRenderer.removeListener(IPC.CODE_REVIEW_COMPLETED, handler)
    },
  },

  // ==================== Session Replay API ====================
  replay: {
    startRecording: (sessionId: string, sessionName: string) => ipcRenderer.invoke(IPC.REPLAY_START_RECORDING, sessionId, sessionName),
    stopRecording: (sessionId: string) => ipcRenderer.invoke(IPC.REPLAY_STOP_RECORDING, sessionId),
    get: (id: string) => ipcRenderer.invoke(IPC.REPLAY_GET, id),
    list: (limit?: number) => ipcRenderer.invoke(IPC.REPLAY_LIST, limit),
    delete: (id: string) => ipcRenderer.invoke(IPC.REPLAY_DELETE, id),
    export: (id: string) => ipcRenderer.invoke(IPC.REPLAY_EXPORT, id),
    getEvents: (id: string) => ipcRenderer.invoke(IPC.REPLAY_GET_EVENTS, id),
    settings: (updates?: { autoRecordEnabled?: boolean; maxDuration?: number; captureEvents?: string[] }) =>
      ipcRenderer.invoke(IPC.REPLAY_SETTINGS, updates),
    isRecording: (sessionId: string) => ipcRenderer.invoke(IPC.REPLAY_IS_RECORDING, sessionId),
  },

  // ==================== Context Budget API ====================
  contextBudget: {
    get: (sessionId: string) => ipcRenderer.invoke(IPC.CONTEXT_BUDGET_GET, sessionId),
    update: (updates: any) => ipcRenderer.invoke(IPC.CONTEXT_BUDGET_UPDATE, updates),
    compress: (sessionId: string) => ipcRenderer.invoke(IPC.CONTEXT_BUDGET_COMPRESS, sessionId),
    migrate: (sessionId: string) => ipcRenderer.invoke(IPC.CONTEXT_BUDGET_MIGRATE, sessionId),
    status: () => ipcRenderer.invoke(IPC.CONTEXT_BUDGET_STATUS),
    // 监听超阈值告警（由主进程 usage-update 事件推送）
    onAlert: (callback: (alert: { sessionId: string; level: string; used: number; max: number; percent: number }) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on(IPC.CONTEXT_BUDGET_ALERT, handler)
      return () => ipcRenderer.removeListener(IPC.CONTEXT_BUDGET_ALERT, handler)
    },
  },

  // ==================== Battle API ====================
  battle: {
    create: (params: any) => ipcRenderer.invoke(IPC.BATTLE_CREATE, params),
    get: (id: string) => ipcRenderer.invoke(IPC.BATTLE_GET, id),
    list: (limit?: number) => ipcRenderer.invoke(IPC.BATTLE_LIST, limit),
    vote: (battleId: string, voterId: string, choice: string, comment?: string) => ipcRenderer.invoke(IPC.BATTLE_VOTE, battleId, voterId, choice, comment),
    delete: (id: string) => ipcRenderer.invoke(IPC.BATTLE_DELETE, id),
    getStats: () => ipcRenderer.invoke(IPC.BATTLE_GET_STATS),
  },

  // ==================== Daily Report API ====================
  dailyReport: {
    generate: (date?: string) => ipcRenderer.invoke(IPC.DAILY_REPORT_GENERATE, date),
    get: (date: string) => ipcRenderer.invoke(IPC.DAILY_REPORT_GET, date),
    list: (limit?: number) => ipcRenderer.invoke(IPC.DAILY_REPORT_LIST, limit),
    export: (date: string) => ipcRenderer.invoke(IPC.DAILY_REPORT_EXPORT, date),
    config: (updates?: any) => ipcRenderer.invoke(IPC.DAILY_REPORT_CONFIG, updates),
    delete: (date: string) => ipcRenderer.invoke(IPC.DAILY_REPORT_DELETE, date),
  },

  // ==================== Skill Arena API ====================
  skillArena: {
    list: (category?: string, limit?: number) => ipcRenderer.invoke(IPC.SKILL_ARENA_LIST, category, limit),
    submit: (params: any) => ipcRenderer.invoke(IPC.SKILL_ARENA_SUBMIT, params),
    getScores: (id: string) => ipcRenderer.invoke(IPC.SKILL_ARENA_GET_SCORES, id),
    getLeaderboard: (category?: string) => ipcRenderer.invoke(IPC.SKILL_ARENA_GET_LEADERBOARD, category),
    vote: (id: string, up: boolean) => ipcRenderer.invoke(IPC.SKILL_ARENA_VOTE, id, up),
    delete: (id: string) => ipcRenderer.invoke(IPC.SKILL_ARENA_DELETE, id),
    getCategories: () => ipcRenderer.invoke(IPC.SKILL_ARENA_CATEGORIES),
    getStats: () => ipcRenderer.invoke(IPC.SKILL_ARENA_GET_STATS),
  },

  // ==================== Voice API ====================
  voice: {
    startListening: () => ipcRenderer.invoke(IPC.VOICE_START_LISTENING),
    stopListening: () => ipcRenderer.invoke(IPC.VOICE_STOP_LISTENING),
    speak: (text: string) => ipcRenderer.invoke(IPC.VOICE_SPEAK, text),
    getStatus: () => ipcRenderer.invoke(IPC.VOICE_GET_STATUS),
    getConfig: () => ipcRenderer.invoke(IPC.VOICE_GET_CONFIG),
    updateConfig: (updates: any) => ipcRenderer.invoke(IPC.VOICE_UPDATE_CONFIG, updates),
    transcribe: (data: any) => ipcRenderer.invoke(IPC.VOICE_TRANSCRIBE, data),
    getHistory: (limit?: number) => ipcRenderer.invoke(IPC.VOICE_GET_HISTORY, limit),
    clearHistory: () => ipcRenderer.invoke(IPC.VOICE_CLEAR_HISTORY),
    simulateInput: (text: string) => ipcRenderer.invoke(IPC.VOICE_SIMULATE_INPUT, text),
  },

  // ★ 渲染进程注册 API 就绪回调（避免轮询）
  __registerAPIAvailableCallback: (cb: () => void) => { _apiReadyCallbacks.push(cb) },
  }

  // API 就绪回调队列（非 context-isolated 全局）
  const _apiReadyCallbacks: (() => void)[] = []

  // 重新暴露回调注册给渲染进程（绕过 contextBridge）
  ;(globalThis as any).__spectrAIOnReady = (cb: () => void) => { _apiReadyCallbacks.push(cb) }

  console.log('[Preload] Calling exposeInMainWorld...')
  ctxBr.exposeInMainWorld('spectrAI', api)
  console.log('[Preload] exposeInMainWorld completed successfully')

  // ★ 通知所有等待者
  _apiReadyCallbacks.forEach(cb => { try { cb() } catch {} })

  // ★ 验证：尝试访问已暴露的 API
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.log('[Preload] Verification - window.spectrAI should be available now')
  }, 1000)

} // 关闭 else 块
