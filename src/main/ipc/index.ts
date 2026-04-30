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
import type { MemoryCoordinator } from '../memory/MemoryCoordinator'
import type { TeamManager } from '../team/TeamManager'
import type { TelegramBotService } from '../telegram/TelegramBotService'
import type { FeishuService } from '../feishu/FeishuService'
import type { SchedulerService } from '../scheduler/SchedulerService'
import type { EvaluationService } from '../evaluation/EvaluationService'
import type { PlannerService } from '../planner/PlannerService'
import type { WorkflowService } from '../workflow/WorkflowService'
import type { SummaryService } from '../summary/SummaryService'
import type { GoalService } from '../goal/GoalService'
import type { PromptOptimizerService } from '../prompt-optimizer/PromptOptimizerService'
import type { WorkingContextService } from '../working-context/WorkingContextService'
import type { DriftGuardService } from '../drift-guard/DriftGuardService'
import type { CrossSessionMemoryService } from '../cross-session-memory/CrossSessionMemoryService'
import type { SessionTemplateService } from '../session-template/SessionTemplateService'
import type { CodeContextInjectionService } from '../code-context/CodeContextInjectionService'
import type { CodeGraphService } from '../code-graph/CodeGraphService'
import type { AdapterRegistry } from '../adapter/AdapterRegistry'
import type { CheckpointService } from '../checkpoint/CheckpointService'
import type { CostService } from '../cost/CostService'
import type { ProjectKnowledgeService } from '../knowledge/ProjectKnowledgeService'
import type { ReferenceProjectService } from '../reference/ReferenceProjectService'
import type { CodeReviewService } from '../review/CodeReviewService'
import type { SessionReplayService } from '../replay/SessionReplayService'
import type { ContextBudgetService } from '../context-budget/ContextBudgetService'
import type { BattleService } from '../battle/BattleService'
import type { DailyReportService } from '../daily-report/DailyReportService'
import type { SkillArenaService } from '../arena/SkillArenaService'
import type { VoiceService } from '../voice/VoiceService'
import type { CommunityPublishService } from '../community/CommunityPublishService'
import type { KnowledgeCenterService } from '../knowledge/KnowledgeCenterService'
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
  agentBridgeToken?: string
  taskCoordinator?: TaskSessionCoordinator
  updateManager?: UpdateManager
  memoryCoordinator?: MemoryCoordinator
  teamManager?: TeamManager
  telegramBotService?: TelegramBotService
  feishuService?: FeishuService
  schedulerService?: SchedulerService
  evaluationService?: EvaluationService
  plannerService?: PlannerService
  workflowService?: WorkflowService
  summaryService?: SummaryService
  goalService?: GoalService
  promptOptimizerService?: PromptOptimizerService
  workingContextService?: WorkingContextService
  driftGuardService?: DriftGuardService
  crossSessionMemoryService?: CrossSessionMemoryService
  sessionTemplateService?: SessionTemplateService
  codeContextInjectionService?: CodeContextInjectionService
  codeGraphService?: CodeGraphService
  adapterRegistry?: AdapterRegistry
  checkpointService?: CheckpointService
  costService?: CostService
  projectKnowledgeService?: ProjectKnowledgeService
  referenceProjectService?: ReferenceProjectService
  codeReviewService?: CodeReviewService
  sessionReplayService?: SessionReplayService
  contextBudgetService?: ContextBudgetService
  battleService?: BattleService
  dailyReportService?: DailyReportService
  skillArenaService?: SkillArenaService
  voiceService?: VoiceService
  communityPublishService?: CommunityPublishService
  knowledgeCenterService?: KnowledgeCenterService
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
import { registerCodeGraphHandlers } from './codeGraphHandlers'
import { registerShipHandlers } from './shipHandlers'
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
  registerShipHandlers()
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
  if (deps.codeGraphService) {
    registerCodeGraphHandlers(deps.codeGraphService)
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
