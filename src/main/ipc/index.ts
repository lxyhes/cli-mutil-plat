/**
 * IPC 通信模块 - 注册所有 IPC handler 并导出公共工具
 * @author weibin
 */

import type { DatabaseManager } from '../storage/Database'
import type { ConcurrencyGuard } from '../session/ConcurrencyGuard'
import type { NotificationManager } from '../notification/NotificationManager'
import type { TrayManager } from '../tray/TrayManager'
import type { SessionManager } from '../session/SessionManager'
import type { OutputParser } from '../parser/OutputParser'
import type { StateInference } from '../parser/StateInference'
import type { AgentManager } from '../agent/AgentManager'
import type { OutputReaderManager } from '../reader/OutputReaderManager'
import type { TaskSessionCoordinator } from '../task/TaskSessionCoordinator'
import type { AgentManagerV2 } from '../agent/AgentManagerV2'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { UpdateManager } from '../update/UpdateManager'
// ★ 公共工具从 shared.ts 导出，避免 handler → index → handler 循环依赖
export { sendToRenderer, aiRenamingLocks, performAiRename } from './shared'
// ★ IPC 错误处理中间件
export { wrapIpcHandler, formatUserFriendlyError, registerWrappedHandlers } from './errorMiddleware'

/**
 * Manager 依赖注入接口
 * 注：SDK V2 架构下 PTY 相关 manager（outputParser / stateInference /
 *   outputReaderManager / agentManager / sessionManager）为可选
 */
export interface IpcDependencies {
  sessionManager: SessionManager
  sessionManagerV2?: SessionManagerV2
  database: DatabaseManager
  outputParser: OutputParser
  concurrencyGuard: ConcurrencyGuard
  stateInference?: StateInference
  notificationManager: NotificationManager
  trayManager: TrayManager
  agentManager?: AgentManager
  agentManagerV2?: AgentManagerV2
  outputReaderManager?: OutputReaderManager
  agentBridgePort?: number
  taskCoordinator?: TaskSessionCoordinator
  updateManager?: UpdateManager
  memoryCoordinator?: any  // MemoryCoordinator（可选）
  teamManager?: any  // TeamManager（可选）
  telegramBotService?: any  // TelegramBotService（可选）
  feishuService?: any  // FeishuService（可选）
  schedulerService?: any  // SchedulerService（可选）
  evaluationService?: any  // EvaluationService（可选）
  plannerService?: any  // PlannerService（可选）
  workflowService?: any  // WorkflowService（可选）
  summaryService?: any  // SummaryService（可选）
  goalService?: any  // GoalService（可选）
  promptOptimizerService?: any  // PromptOptimizerService（可选）
  workingContextService?: any  // WorkingContextService（可选）
  driftGuardService?: any  // DriftGuardService（可选）
  crossSessionMemoryService?: any  // CrossSessionMemoryService（可选）
  sessionTemplateService?: any  // SessionTemplateService（可选）
  codeContextInjectionService?: any  // CodeContextInjectionService（可选）
  adapterRegistry?: any  // AdapterRegistry（可选）
  // ★ 新增 10 大功能服务
  checkpointService?: any       // CheckpointService（可选）
  costService?: any             // CostService（可选）
  projectKnowledgeService?: any // ProjectKnowledgeService（可选）
  referenceProjectService?: any // ReferenceProjectService（可选）
  codeReviewService?: any       // CodeReviewService（可选）
  sessionReplayService?: any    // SessionReplayService（可选）
  contextBudgetService?: any    // ContextBudgetService（可选）
  battleService?: any           // BattleService（可选）
  dailyReportService?: any      // DailyReportService（可选）
  skillArenaService?: any       // SkillArenaService（可选）
  voiceService?: any            // VoiceService（可选）
  communityPublishService?: any // CommunityPublishService（可选）
  knowledgeCenterService?: any  // KnowledgeCenterService（可选）
}

// 各子模块 handler 注册函数
import { registerSessionHandlers } from './sessionHandlers'
import { registerTaskHandlers } from './taskHandlers'
import { registerAgentHandlers } from './agentHandlers'
import { registerProviderHandlers } from './providerHandlers'
import { registerGitHandlers } from './gitHandlers'
import { registerSystemHandlers } from './systemHandlers'
import { registerWorkspaceHandlers } from './workspaceHandlers'
import { registerFileManagerHandlers } from './fileManagerHandlers'
import { registerMcpHandlers } from './mcpHandlers'
import { registerSkillHandlers } from './skillHandlers'
import { registerRegistryHandlers } from './registryHandlers'
import { registerUpdateHandlers } from './updateHandlers'
import { registerAnalyzerHandlers } from './analyzerHandlers'
import { registerTeamHandlers } from './teamHandlers'
import { registerTelegramHandlers } from './telegramHandlers'
import { registerFeishuHandlers } from './feishuHandlers'
import { registerSchedulerHandlers } from './schedulerHandlers'
import { registerPlannerHandlers } from './plannerHandlers'
import { registerWorkflowHandlers } from './workflowHandlers'
import { registerEvaluationHandlers } from './evaluationHandlers'
import { registerSummaryHandlers } from './summaryHandlers'
import { registerGoalHandlers } from './goalHandlers'
import { registerPromptOptimizerHandlers } from './promptOptimizerHandlers'
import { registerWorkingContextHandlers } from './workingContextHandlers'
import { registerDriftGuardHandlers } from './driftGuardHandlers'
import { registerCrossMemoryHandlers } from './crossMemoryHandlers'
import { registerSessionTemplateHandlers } from './sessionTemplateHandlers'
import { registerCodeContextHandlers } from './codeContextHandlers'
import { registerOpenAICompatHandlers } from './openAICompatHandlers'
import { registerNewFeatureHandlers, type NewFeatureDeps } from './newFeatureHandlers'
import { registerKnowledgeCenterHandlers } from './knowledgeCenterHandlers'
import type { FileChangeTracker } from '../tracker/FileChangeTracker'

// re-export wireSessionManagerV2Events from systemHandlers
export { wireSessionManagerV2Events } from './systemHandlers'

/**
 * Register all IPC handlers
 * @param deps manager dependencies
 * @param fileChangeTracker optional file change tracker
 */
export function registerIpcHandlers(deps: IpcDependencies, fileChangeTracker?: FileChangeTracker): void {
  registerSessionHandlers(deps)
  registerTaskHandlers(deps)
  registerAgentHandlers(deps)
  registerProviderHandlers(deps)
  registerGitHandlers(deps, fileChangeTracker)
  registerSystemHandlers(deps)
  registerWorkspaceHandlers(deps)
  registerFileManagerHandlers(deps, fileChangeTracker)
  registerMcpHandlers(deps)
  registerSkillHandlers(deps)
  registerRegistryHandlers(deps)
  registerAnalyzerHandlers(deps)
  registerTeamHandlers({ teamManager: deps.teamManager! })
  registerTelegramHandlers(deps)
  registerFeishuHandlers(deps)
  registerSchedulerHandlers(deps)
  registerPlannerHandlers(deps)
  registerWorkflowHandlers(deps)
  registerEvaluationHandlers(deps)
  registerSummaryHandlers(deps)
  registerGoalHandlers(deps)
  registerPromptOptimizerHandlers(deps)
  // ★ 新增 7 个差异化功能的 IPC 注册
  if (deps.workingContextService) {
    registerWorkingContextHandlers(deps.workingContextService)
  }
  if (deps.driftGuardService) {
    registerDriftGuardHandlers(deps.driftGuardService)
  }
  if (deps.crossSessionMemoryService) {
    registerCrossMemoryHandlers(deps.crossSessionMemoryService)
  }
  if (deps.sessionTemplateService) {
    registerSessionTemplateHandlers(deps.sessionTemplateService)
  }
  if (deps.codeContextInjectionService) {
    registerCodeContextHandlers(deps.codeContextInjectionService)
  }
  // ★ OpenAI Compatible Provider 需要 adapterRegistry
  if (deps.adapterRegistry) {
    registerOpenAICompatHandlers(deps.adapterRegistry)
  }
  if (deps.updateManager) {
    registerUpdateHandlers(deps.updateManager)
  }
  // ★ 新增 10 大功能 IPC 注册
  registerNewFeatureHandlers({
    checkpointService: deps.checkpointService,
    costService: deps.costService,
    projectKnowledgeService: deps.projectKnowledgeService,
    codeReviewService: deps.codeReviewService,
    sessionReplayService: deps.sessionReplayService,
    contextBudgetService: deps.contextBudgetService,
    battleService: deps.battleService,
    dailyReportService: deps.dailyReportService,
    skillArenaService: deps.skillArenaService,
    voiceService: deps.voiceService,
    communityPublishService: deps.communityPublishService,
  })

  // ★ 知识中心 IPC 注册
  if (deps.knowledgeCenterService) {
    registerKnowledgeCenterHandlers(deps.knowledgeCenterService)
  }
}
