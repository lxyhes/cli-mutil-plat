/**
 * Preload 类型声明 - 为渲染进程提供类型支持
 * @author weibin
 */

export interface SpectrAIAPI {
  [key: string]: any

  clipboard: {
    readText: () => string
    writeText: (text: string) => void
  }

  theme: {
    updateTitleBar: (themeId: string) => void
  }

  update: {
    getState: () => Promise<{
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      currentVersion: string
      latestVersion?: string
      isMajorUpdate?: boolean
      releaseNotes?: string
      percent?: number
      message?: string
    }>
    checkForUpdates: (manual?: boolean) => Promise<{ success: boolean; state: any }>
    downloadUpdate: () => Promise<{ success: boolean; state: any }>
    quitAndInstall: () => Promise<{ success: boolean }>
    openDownloadPage: () => Promise<{ success: boolean }>
    onStateChanged: (callback: (state: any) => void) => () => void
  }

  app: {
    getCwd: () => string
    getHomePath: () => string
    selectDirectory: () => Promise<string | null>
    selectFile: () => Promise<string | null>
    getRecentDirectories: (limit?: number) => Promise<Array<{
      path: string
      isPinned: boolean
      useCount: number
      lastUsedAt: string
    }>>
    toggleDirectoryPin: (dirPath: string) => Promise<{ success: boolean }>
    removeDirectory: (dirPath: string) => Promise<{ success: boolean }>
  }

  session: {
    [key: string]: any
    create: (config: any) => Promise<any>
    terminate: (sessionId: string) => Promise<any>
    sendInput: (sessionId: string, input: string) => Promise<any>
    confirm: (sessionId: string, confirmed: boolean) => Promise<any>
    resize: (sessionId: string, cols: number, rows: number) => Promise<any>
    getOutput: (sessionId: string) => Promise<string[]>
    getAll: () => Promise<any[]>
    getHistory: () => Promise<any[]>
    getActivities: (sessionId: string, limit?: number) => Promise<any[]>
    resume: (oldSessionId: string) => Promise<any>
    getLogs: (sessionId: string) => Promise<string[]>
    rename: (sessionId: string, newName: string) => Promise<any>
    aiRename: (sessionId: string) => Promise<any>
    delete: (sessionId: string) => Promise<any>
    togglePin: (sessionId: string) => Promise<any>
    setModel: (sessionId: string, modelId: string, options?: { reasoningEffort?: string }) => Promise<any>
    getStats: (sessionId: string) => Promise<{
      tokenCount: number
      duration: number
      outputLines?: number
    }>
    onOutput: (callback: (sessionId: string, data: any) => void) => () => void
    onStatusChange: (callback: (sessionId: string, status: string) => void) => () => void
    onActivity: (callback: (sessionId: string, activity: any) => void) => () => void
    onIntervention: (callback: (sessionId: string, intervention: any) => void) => () => void
    onNameChange: (callback: (sessionId: string, name: string) => void) => () => void
    onRefresh: (callback: () => void) => () => void  // 会话列表刷新（远程创建/终止会话时触发）

    // SDK V2 扩展方法
    sendMessage: (sessionId: string, text: string) => Promise<any>
    getConversation: (sessionId: string) => Promise<any[]>
    abortSession: (sessionId: string) => Promise<any>
    respondPermission: (sessionId: string, accept: boolean) => Promise<any>
    answerQuestion: (sessionId: string, answers: Record<string, string>) => Promise<any>
    approvePlan: (sessionId: string, approved: boolean) => Promise<any>
    getQueue: (sessionId: string) => Promise<any>
    clearQueue: (sessionId: string) => Promise<any>
    onConversationMessage: (callback: (sessionId: string, msg: any) => void) => () => void
    onInitData: (callback: (sessionId: string, data: any) => void) => () => void
    onAuthRequired: (callback: (sessionId: string, data: any) => void) => () => void
    onTokenUpdate: (callback: (sessionId: string, usage: any) => void) => () => void
  }

  task: {
    [key: string]: any
    create: (task: any) => Promise<any>
    update: (taskId: string, updates: any) => Promise<any>
    delete: (taskId: string) => Promise<any>
    getAll: () => Promise<any[]>
    startSession: (taskId: string, config?: any) => Promise<any>
    onStatusChange: (callback: (taskId: string, updates: any) => void) => () => void
  }

  ship: {
    createPlan: (projectPath: string) => Promise<any>
    runPlan: (projectPath: string, options?: any) => Promise<any>
    generateChangeSummary: (projectPath: string) => Promise<any>
  }


  provider: {
    [key: string]: any
    getAll: () => Promise<any[]>
    get: (id: string) => Promise<any | null>
    create: (provider: any) => Promise<any>
    update: (id: string, updates: any) => Promise<any>
    delete: (id: string) => Promise<any>
    reorder: (ids: string[]) => Promise<any>
    /** 检测 CLI 命令是否已安装，返回安装路径 */
    checkCli: (command: string) => Promise<any>
    /** 测试 Claude Code 可执行文件（cli.js）是否可用，支持自动检测或验证指定路径 */
    testExecutable: (executablePath?: string) => Promise<any>
    /** 在系统终端中运行 Provider 认证命令（如 qwen auth） */
    runAuthCli: (command: string, args?: string[]) => Promise<{ success: boolean; error?: string }>
    /** 收藏/取消收藏 Provider */
    togglePin: (id: string) => Promise<any>
  }

  providerHealth: {
    start: () => Promise<{ started: boolean }>
    stop: () => Promise<{ stopped: boolean }>
    getAll: () => Promise<{
      statuses: Array<{
        providerId: string
        providerName: string
        status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
        lastCheckedAt: string
        responseTimeMs?: number
        errorMessage?: string
        consecutiveFailures: number
        successRate: number
      }>
    }>
    getStatus: (providerId: string) => Promise<{
      status?: {
        providerId: string
        providerName: string
        status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
        lastCheckedAt: string
        responseTimeMs?: number
        errorMessage?: string
        consecutiveFailures: number
        successRate: number
      }
    }>
    getHealthy: () => Promise<{ providers: any[] }>
    getRecommended: (preferredProviderId?: string) => Promise<{ provider: any | null }>
    checkManual: (providerId: string) => Promise<{
      result?: {
        providerId: string
        isHealthy: boolean
        responseTimeMs: number
        error?: string
      }
    }>
    updateConfig: (config: {
      enabled?: boolean
      maxConsecutiveFailures?: number
      minSuccessRate?: number
      checkIntervalMs?: number
      fallbackProviderIds?: string[]
    }) => Promise<{ config: any }>
    getConfig: () => Promise<{
      config: {
        enabled: boolean
        maxConsecutiveFailures: number
        minSuccessRate: number
        checkIntervalMs: number
        fallbackProviderIds: string[]
      }
    }>
  },

  nvm: {
    listVersions: () => Promise<string[]>
  }

  search: {
    logs: (query: string, sessionId?: string, limit?: number) => Promise<Array<{
      id: number
      sessionId: string
      sessionName: string
      timestamp: string
      chunk: string
      highlight: string
    }>>
  }

  usage: {
    getSummary: () => Promise<{
      totalTokens: number
      totalMinutes: number
      todayTokens: number
      todayMinutes: number
      activeSessions: number
      sessionBreakdown: Record<string, number>
    }>
    getHistory: (days?: number) => Promise<{
      dailyStats: Array<{
        date: string
        tokens: number
        minutes: number
        sessions: number
      }>
      sessionStats: Array<{
        sessionId: string
        sessionName: string
        tokens: number
        minutes: number
      }>
    }>
    flush: () => Promise<{ success: boolean }>
  }

  memory: {
    getReport: () => Promise<{
      timestamp: number
      components: Array<{
        name: string
        status: 'healthy' | 'warning' | 'critical'
        memoryUsage: number
        details?: Record<string, unknown>
      }>
      summary: {
        totalAllocated: number
        totalUsed: number
        healthStatus: 'healthy' | 'warning' | 'critical'
      }
    }>
    forceCleanup: (mode?: 'normal' | 'aggressive') => Promise<{
      success: boolean
      freedMemory: number
      errors: string[]
    }>
  }

  /** @deprecated use usage.getSummary() */
  getUsageSummary: () => Promise<{
    totalTokens: number
    sessionBreakdown: Record<string, number>
  }>

  agent: {
    list: (parentSessionId?: string) => Promise<Array<{
      agentId: string
      name: string
      parentSessionId: string
      childSessionId: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
      prompt: string
      workDir: string
      createdAt: string
      completedAt?: string
      outcome?: any
      result?: {
        success: boolean
        exitCode: number
        output?: string
        error?: string
        artifacts?: string[]
      }
    }>>
    cancel: (agentId: string) => Promise<{ success: boolean; error?: string }>
    onCreated: (callback: (agentInfo: any) => void) => () => void
    onStatusChange: (callback: (agentId: string, status: string) => void) => () => void
    onCompleted: (callback: (agentId: string, result: any) => void) => () => void
  }

  summary: {
    getLatest: (sessionId: string) => Promise<any>
    getAll: (sessionId: string, limit?: number) => Promise<any[]>
    getAllSessions: () => Promise<any[]>
  }

  git: {
    [key: string]: any
    isRepo: (dirPath: string) => Promise<boolean>
    getBranches: (repoPath: string) => Promise<string[]>
    getCurrentBranch: (repoPath: string) => Promise<string | null>
    detectMainBranch: (repoPath: string) => Promise<string | null>
    getRepoRoot: (dirPath: string) => Promise<string | null>
    isDirty: (dirPath: string) => Promise<boolean>
    getStatus: (repoPath: string) => Promise<any>
    getFileDiff: (repoPath: string, filePath: string, staged?: boolean, commitHash?: string) => Promise<any>
    stage: (repoPath: string, filePaths: string[]) => Promise<any>
    unstage: (repoPath: string, filePaths: string[]) => Promise<any>
    discard: (repoPath: string, filePaths: string[]) => Promise<any>
    stageAll: (repoPath: string) => Promise<any>
    commit: (repoPath: string, message: string) => Promise<any>
    pull: (repoPath: string) => Promise<any>
    push: (repoPath: string) => Promise<any>
    getLog: (repoPath: string, limit?: number) => Promise<any>
    getRemoteStatus: (repoPath: string) => Promise<{
      hasUpstream: boolean
      upstream: string | null
      ahead: number
      behind: number
    }>
    getCommitFiles: (repoPath: string, hash: string) => Promise<any>
    /** 自动创建 commit 并关联交付包 */
    autoCommitWithDeliveryPack: (options: {
      repoPath: string
      commitMessage: string
      deliveryPackHash?: string
      stageAll?: boolean
      pushToRemote?: boolean
    }) => Promise<{ success: boolean; data?: { success: boolean; commitHash?: string; pushed?: boolean }; error?: any }>
    /** 从交付包中提取建议的提交信息 */
    extractCommitMessage: (deliveryPackMarkdown: string) => Promise<{ success: boolean; data?: { message: string }; error?: any }>
  }

  worktree: {
    create: (repoPath: string, branch: string, taskId: string) => Promise<{ success: boolean; worktreePath?: string; branch?: string; error?: string }>
    remove: (repoPath: string, worktreePath: string, deleteBranch?: boolean, branchName?: string) => Promise<{ success: boolean; error?: string }>
    list: (repoPath: string) => Promise<Array<{ path: string; head: string; branch: string; isMain: boolean }>>
    checkMerge: (repoPath: string, worktreePath: string) => Promise<{
      mainBranch: string
      mainAheadCount: number
      conflictingFiles: string[]
      canMerge: boolean
      error?: string
    }>
    merge: (repoPath: string, branchName: string, options?: { squash?: boolean; message?: string; cleanup?: boolean }) => Promise<{
      success: boolean
      mainBranch?: string
      linesAdded?: number
      linesRemoved?: number
      error?: string
    }>
  }

  workspace: {
    list: () => Promise<any[]>
    get: (id: string) => Promise<any | null>
    create: (data: any) => Promise<{ success: boolean; workspaceId?: string; error?: string }>
    update: (id: string, data: any) => Promise<{ success: boolean; error?: string }>
    delete: (id: string) => Promise<{ success: boolean; error?: string }>
    scanRepos: (dirPath: string) => Promise<{ success: boolean; repos?: Array<{ repoPath: string; name: string }>; error?: string }>
    importVscode: (filePath: string) => Promise<{ success: boolean; repos?: Array<{ repoPath: string; name: string }>; error?: string }>
  }


  shortcut: {
    onViewMode: (callback: (mode: string) => void) => () => void
    onCycleTerminal: (callback: () => void) => () => void
    onNewSession: (callback: () => void) => () => void
    onNewTaskSession: (callback: () => void) => () => void
    onToggleSidebar: (callback: () => void) => () => void
    onSearch: (callback: () => void) => () => void
  }

  fileManager: {
    listDir: (path: string) => Promise<import('../shared/fileManagerTypes').DirListing & { error?: string }>
    openPath: (path: string) => Promise<{ success: boolean; error?: string }>
    readFile: (path: string) => Promise<{ content?: string; error?: string }>
    watchDir: (path: string) => Promise<{ success: boolean }>
    unwatchDir: (path: string) => Promise<{ success: boolean }>
    writeFile: (path: string, content: string) => Promise<{ success?: boolean; error?: string }>
    onWatchChange: (callback: (event: import('../shared/fileManagerTypes').FileWatchEvent) => void) => () => void
    getSessionFiles: (sessionId: string) => Promise<any[]>
    onSessionFilesUpdated: (callback: (data: { sessionId: string; files: any[] }) => void) => () => void
    listProjectFiles: (dirPath: string, maxResults?: number) => Promise<{ files: any[]; total: number; truncated: boolean; error?: string }>
    getDiff: (filePath: string) => Promise<{ hunks: any[]; raw: string; error?: string }>
    createFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
    createDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
    rename: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>
    delete: (targetPath: string) => Promise<{ success: boolean; error?: string }>
    showInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
  }

  team: {
    create: (request: any) => Promise<{ success: boolean; team?: any; error?: string }>
    getAll: (status?: string) => Promise<{ success: boolean; teams?: any[]; error?: string }>
    get: (teamId: string) => Promise<{ success: boolean; team?: any; error?: string }>
    getTasks: (teamId: string, status?: string) => Promise<{ success: boolean; tasks?: any[]; error?: string }>
    getMessages: (teamId: string, limit?: number) => Promise<{ success: boolean; messages?: any[]; error?: string }>
    createTask: (teamId: string, task: any) => Promise<{ success: boolean; task?: any; error?: string }>
    completeTask: (teamId: string, taskId: string, result: string) => Promise<{ success: boolean; error?: string }>
    updateTask: (teamId: string, taskId: string, updates: any) => Promise<{ success: boolean; task?: any; error?: string }>
    cancelTask: (teamId: string, taskId: string, reason?: string) => Promise<{ success: boolean; error?: string }>
    reassignTask: (teamId: string, taskId: string, newMemberId: string) => Promise<{ success: boolean; error?: string }>
    retryTask: (teamId: string, taskId: string, options?: { memberId?: string; note?: string }) => Promise<{ success: boolean; task?: any; error?: string }>
    getTemplates: () => Promise<{ success: boolean; templates?: any[]; error?: string }>
    createTemplate: (template: any) => Promise<{ success: boolean; template?: any; error?: string }>
    updateTemplate: (templateId: string, updates: any) => Promise<{ success: boolean; template?: any; error?: string }>
    deleteTemplate: (templateId: string) => Promise<{ success: boolean; error?: string }>
    getHealth: (teamId: string) => Promise<{ success: boolean; health?: any; error?: string }>
    cleanup: (teamId: string) => Promise<{ success: boolean; error?: string }>
    cancel: (teamId: string, reason?: string) => Promise<{ success: boolean; error?: string }>
    pause: (teamId: string) => Promise<{ success: boolean; error?: string }>
    resume: (teamId: string) => Promise<{ success: boolean; error?: string }>
    update: (teamId: string, updates: any) => Promise<{ success: boolean; error?: string }>
    updateMember: (teamId: string, memberId: string, updates: any) => Promise<{ success: boolean; member?: any; error?: string }>
    sendMessage: (teamId: string, toMemberId: string, content: string) => Promise<{ success: boolean; message?: any; error?: string }>
    broadcast: (teamId: string, content: string) => Promise<{ success: boolean; message?: any; error?: string }>
    getTaskDAG: (teamId: string) => Promise<{ success: boolean; dag?: any[]; validation?: any; error?: string }>
    validateDependencies: (teamId: string) => Promise<{ success: boolean; validation?: any; error?: string }>
    exportTeam: (teamId: string) => Promise<{ success: boolean; snapshot?: any; error?: string }>
    importTeam: (snapshot: any) => Promise<{ success: boolean; team?: any; error?: string }>
    mergeWorktrees: (teamId: string, options?: any) => Promise<{ success: boolean; results?: any[]; error?: string }>
    // 事件监听
    onStatusChange: (callback: (teamId: string, status: string) => void) => () => void
    onMemberJoined: (callback: (teamId: string, member: any) => void) => () => void
    onMemberStatusChange: (callback: (teamId: string, memberId: string, status: string) => void) => () => void
    onTaskClaimed: (callback: (teamId: string, taskId: string, memberId: string) => void) => () => void
    onTaskCompleted: (callback: (teamId: string, taskId: string) => void) => () => void
    onTaskCancelled: (callback: (teamId: string, taskId: string) => void) => () => void
    onMessage: (callback: (teamId: string, message: any) => void) => () => void
    onCompleted: (callback: (teamId: string) => void) => () => void
    onFailed: (callback: (teamId: string, reason: string) => void) => () => void
    onCancelled: (callback: (teamId: string, reason: string) => void) => () => void
    onPaused: (callback: (teamId: string) => void) => () => void
    onResumed: (callback: (teamId: string) => void) => () => void
    onUpdated: (callback: (teamId: string, updates: any) => void) => () => void
    onHealthIssue: (callback: (teamId: string, issue: any) => void) => () => void
    onLog: (callback: (entry: any) => void) => () => void
  }

  evaluation: {
    createTemplate: (data: any) => Promise<{ success: boolean; template?: any; error?: string }>
    listTemplates: () => Promise<{ success: boolean; templates?: any[]; error?: string }>
    getTemplate: (templateId: string) => Promise<{ success: boolean; template?: any; error?: string }>
    updateTemplate: (templateId: string, updates: any) => Promise<{ success: boolean; templateId?: string; error?: string }>
    deleteTemplate: (templateId: string) => Promise<{ success: boolean; error?: string }>
    startRun: (sessionId: string, templateId: string) => Promise<{ success: boolean; runId?: string; error?: string }>
    listRuns: (limit?: number) => Promise<{ success: boolean; runs?: any[]; error?: string }>
    getRun: (runId: string) => Promise<{ success: boolean; run?: any; error?: string }>
    getResults: (runId: string) => Promise<{ success: boolean; results?: any[]; error?: string }>
    onRunStatus: (callback: (status: any) => void) => () => void
  }

  // 会话级工作记忆
  workingContext: {
    get: (sessionId: string) => Promise<any>
    updateTask: (sessionId: string, task: string) => Promise<any>
    addProblem: (sessionId: string, content: string) => Promise<any>
    resolveProblem: (sessionId: string, problemId: string) => Promise<any>
    addDecision: (sessionId: string, content: string) => Promise<any>
    addTodo: (sessionId: string, content: string) => Promise<any>
    resolveTodo: (sessionId: string, todoId: string) => Promise<any>
    addSnippet: (sessionId: string, snippet: any) => Promise<any>
    removeItem: (sessionId: string, category: string, itemId: string) => Promise<any>
    setPinned: (sessionId: string, category: string, itemId: string, pinned: boolean) => Promise<any>
    createSnapshot: (sessionId: string, trigger?: string) => Promise<any>
    getPrompt: (sessionId: string) => Promise<any>
    onStatus: (callback: (status: any) => void) => () => void
  }

  // 漂移检测护栏
  driftGuard: {
    start: (sessionId: string, goalId: string) => Promise<any>
    stop: (sessionId: string) => Promise<any>
    getState: (sessionId: string) => Promise<any>
    resume: (sessionId: string) => Promise<any>
    getPrompt: (sessionId: string) => Promise<any>
    updateConfig: (updates: any) => Promise<any>
    getConfig: () => Promise<any>
    onStatus: (callback: (status: any) => void) => () => void
  }

  // 跨会话语义记忆
  crossMemory: {
    search: (query: string, limit?: number) => Promise<any>
    list: (limit?: number) => Promise<any>
    index: (sessionId: string, sessionName: string, summary: string, keyPoints: string) => Promise<any>
    delete: (id: string) => Promise<any>
    getPrompt: (sessionGoal: string) => Promise<any>
    getStats: () => Promise<any>
    updateConfig: (updates: any) => Promise<any>
  }

  // Memory Deduplication - 记忆去重和版本历史
  memoryDedup: {
    // 相似度计算
    calculateSimilarity: (text1: string, text2: string) => Promise<{
      success: boolean
      result?: {
        score: number
        method: string
        details?: Record<string, any>
      }
      error?: string
    }>
    
    // 去重检测
    detectDuplicates: (newMemory: any, existingMemories: any[]) => Promise<{
      success: boolean
      candidates?: Array<{
        originalId: string
        duplicateId: string
        similarity: {
          score: number
          method: string
          details?: Record<string, any>
        }
        recommendation: 'merge' | 'keep_both' | 'replace'
        reason: string
      }>
      error?: string
    }>
    performCheck: () => Promise<{
      success: boolean
      candidates?: any[]
      error?: string
    }>
    
    // 版本历史
    createVersion: (params: {
      memoryId: string
      content: string
      keyPoints: string
      keywords: string
      summary: string
      createdBy: string
      changeType?: string
      changeReason?: string
      metadata?: Record<string, any>
    }) => Promise<{
      success: boolean
      version?: {
        id: string
        memoryId: string
        version: number
        content: string
        keyPoints: string
        keywords: string
        summary: string
        createdAt: string
        createdBy: string
        changeType: string
        changeReason?: string
        metadata?: Record<string, any>
      }
      error?: string
    }>
    getVersionHistory: (memoryId: string, limit?: number) => Promise<{
      success: boolean
      versions?: Array<{
        id: string
        memoryId: string
        version: number
        content: string
        keyPoints: string
        keywords: string
        summary: string
        createdAt: string
        createdBy: string
        changeType: string
        changeReason?: string
        metadata?: Record<string, any>
      }>
      error?: string
    }>
    analyzeEvolution: (memoryId: string) => Promise<{
      success: boolean
      analysis?: {
        memoryId: string
        versions: any[]
        evolutionSummary: string
        majorChanges: Array<{
          version: number
          changeType: string
          description: string
          timestamp: string
        }>
        stabilityScore: number
      }
      error?: string
    }>
    
    // 合并建议
    generateMergeSuggestion: (memoryIds: string[]) => Promise<{
      success: boolean
      suggestion?: {
        id: string
        memoryIds: string[]
        suggestedContent: string
        confidence: number
        reason: string
        createdAt: string
      }
      error?: string
    }>
    getPendingSuggestions: (limit?: number) => Promise<{
      success: boolean
      suggestions?: Array<{
        id: string
        memoryIds: string[]
        suggestedContent: string
        confidence: number
        reason: string
        createdAt: string
      }>
      error?: string
    }>
    acceptSuggestion: (suggestionId: string) => Promise<{
      success: boolean
      error?: string
    }>
    rejectSuggestion: (suggestionId: string) => Promise<{
      success: boolean
      error?: string
    }>
    
    // 配置管理
    updateConfig: (updates: any) => Promise<{
      success: boolean
      config?: {
        enabled: boolean
        similarityThreshold: number
        jaccardWeight: number
        tfidfWeight: number
        maxVersionsPerMemory: number
        autoMergeEnabled: boolean
        checkIntervalMs: number
      }
      error?: string
    }>
    getConfig: () => Promise<{
      success: boolean
      config?: {
        enabled: boolean
        similarityThreshold: number
        jaccardWeight: number
        tfidfWeight: number
        maxVersionsPerMemory: number
        autoMergeEnabled: boolean
        checkIntervalMs: number
      }
      error?: string
    }>
    getStats: () => Promise<{
      success: boolean
      stats?: {
        totalMemories: number
        totalVersions: number
        pendingSuggestions: number
        openConflicts: number
        averageVersionsPerMemory: number
      }
      error?: string
    }>
  },

  // Cost Optimization - 成本优化路由
  costOptimization: {
    selectProvider: (taskProfile: {
      taskType: 'code_generation' | 'code_review' | 'debugging' | 'architecture' | 'documentation' | 'refactoring' | 'testing' | 'general'
      complexity: 'simple' | 'medium' | 'complex' | 'critical'
      estimatedTokens?: number
      budgetLimit?: number
      urgency: 'low' | 'normal' | 'high' | 'critical'
    }, preferredProviderId?: string) => Promise<{
      success: boolean
      decision?: {
        selectedProvider: {
          id: string
          name: string
          adapterType: string
          defaultModel: string
        }
        reason: string
        alternatives: Array<{
          provider: {
            id: string
            name: string
            adapterType: string
            defaultModel: string
          }
          estimatedCost: number
          pros: string[]
          cons: string[]
        }>
        estimatedCost: number
        estimatedTokens: number
        costSavingVsDefault: number
        confidence: number
      }
      error?: string
    }>,
    checkBudget: () => Promise<{
      success: boolean
      alert?: {
        level: 'info' | 'warning' | 'danger' | 'critical'
        message: string
        currentCost: number
        budgetLimit: number
        usagePercent: number
        suggestedAction?: string
      }
      error?: string
    }>,
    recordUsage: (cost: number) => Promise<{ success: boolean; error?: string }>,
    getReport: (days?: number) => Promise<{
      success: boolean
      report?: {
        providers: Array<{
          providerId: string
          providerName: string
          modelId: string
          modelName: string
          inputPricePer1M: number
          outputPricePer1M: number
          averageTokensPerDollar: number
          successRate: number
          avgResponseTimeMs: number
          costScore: number
          isHealthy: boolean
        }>
        totalCost: number
        totalTokens: number
        averageCostPerToken: number
        recommendations: string[]
      }
      error?: string
    }>,
    getEfficiencies: () => Promise<{
      success: boolean
      efficiencies?: Array<{
        providerId: string
        providerName: string
        modelId: string
        modelName: string
        inputPricePer1M: number
        outputPricePer1M: number
        averageTokensPerDollar: number
        successRate: number
        avgResponseTimeMs: number
        costScore: number
        isHealthy: boolean
      }>
      error?: string
    }>,
    updateConfig: (updates: {
      enabled?: boolean
      autoRoutingEnabled?: boolean
      budgetAlertThresholds?: {
        warning?: number
        danger?: number
        critical?: number
      }
      minCostSavingThreshold?: number
      qualityWeight?: number
      costWeight?: number
      speedWeight?: number
      fallbackStrategy?: 'cheapest' | 'balanced' | 'fastest'
    }) => Promise<{ success: boolean; error?: string }>,
    getConfig: () => Promise<{
      success: boolean
      config?: {
        enabled: boolean
        autoRoutingEnabled: boolean
        budgetAlertThresholds: {
          warning: number
          danger: number
          critical: number
        }
        minCostSavingThreshold: number
        qualityWeight: number
        costWeight: number
        speedWeight: number
        fallbackStrategy: 'cheapest' | 'balanced' | 'fastest'
      }
      error?: string
    }>
  },

  // 会话模板
  sessionTemplate: {
    list: (category?: string) => Promise<any>
    get: (id: string) => Promise<any>
    create: (data: any) => Promise<any>
    update: (id: string, updates: any) => Promise<any>
    delete: (id: string) => Promise<any>
    getCategories: () => Promise<any>
    onStatus: (callback: (status: any) => void) => () => void
  }

  // 代码上下文注入
  codeContext: {
    inject: (request: any) => Promise<any>
    getModes: () => Promise<any>
  }

  // 代码图谱 / 爆炸半径
  codeGraph: {
    indexProject: (projectPath: string) => Promise<any>
    getStats: (projectPath: string) => Promise<any>
    getDependencies: (projectPath: string, filePath: string) => Promise<any>
    getDependents: (projectPath: string, filePath: string) => Promise<any>
    getBlastRadius: (projectPath: string, filePath: string, depth?: number) => Promise<any>
    getSymbols: (projectPath: string, filePath: string) => Promise<any>
    getSymbolBlastRadius: (projectPath: string, filePath: string, changedSymbols?: string[], depth?: number) => Promise<any>
    ask: (projectPath: string, question: string, options?: any) => Promise<any>
  }

  // OpenAI Compatible Provider
  openAICompat: {
    test: (config: any) => Promise<any>
    create: (config: any) => Promise<any>
  }

}

declare global {
  interface Window {
    spectrAI: SpectrAIAPI
  }
}

export {}
