/**
 * IPC Handlers - 10 大新功能
 * @author spectrai
 */
import { ipcMain } from 'electron'
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
import { IPC } from '../../shared/constants'

export interface NewFeatureDeps {
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
}

export function registerNewFeatureHandlers(deps: NewFeatureDeps): void {
  // ── 1. Checkpoint ──
  if (deps.checkpointService) {
    const cp = deps.checkpointService
    ipcMain.handle(IPC.CHECKPOINT_CREATE, async (_, p) => cp.create(p))
    ipcMain.handle(IPC.CHECKPOINT_LIST, async (_, sessionId, limit?) => cp.list(sessionId, limit))
    ipcMain.handle(IPC.CHECKPOINT_GET, async (_, id) => {
      const checkpoint = await cp.get(id)
      return { success: true, checkpoint }
    })
    ipcMain.handle(IPC.CHECKPOINT_RESTORE, async (_, id) => cp.restore(id))
    ipcMain.handle(IPC.CHECKPOINT_DELETE, async (_, id) => cp.delete(id))
    ipcMain.handle(IPC.CHECKPOINT_DIFF, async (_, fromId, toId) => cp.diff(fromId, toId))
    ipcMain.handle(IPC.CHECKPOINT_AUTO_CREATE, async (_, sid, name, path, reason, trigger?) => cp.autoCreate(sid, name, path, reason, trigger))
    ipcMain.handle(IPC.CHECKPOINT_GET_PROMPT, () => cp.getPrompt())
    ipcMain.handle(IPC.CHECKPOINT_SETTINGS, (_, updates?: { autoEnabled?: boolean }) => {
      if (updates?.autoEnabled !== undefined) cp.setAutoEnabled(updates.autoEnabled)
      return { success: true, autoEnabled: cp.isAutoEnabled() }
    })
  }

  // ── 2. Cost Dashboard ──
  if (deps.costService) {
    const cs = deps.costService
    ipcMain.handle(IPC.COST_GET_SUMMARY, async (_, days?) => ({ success: true, result: await cs.getSummary(days) }))
    ipcMain.handle(IPC.COST_GET_HISTORY, async (_, days?) => ({ success: true, result: await cs.getHistory(days) }))
    ipcMain.handle(IPC.COST_GET_BY_SESSION, async (_, sessionId) => ({ success: true, result: await cs.getBySession(sessionId) }))
    ipcMain.handle(IPC.COST_GET_BY_PROVIDER, async () => ({ success: true, result: await cs.getByProvider() }))
    ipcMain.handle(IPC.COST_SET_BUDGET, async (_, config) => ({ success: true, result: await cs.setBudget(config) }))
    ipcMain.handle(IPC.COST_GET_BUDGET, async () => ({ success: true, result: await cs.getBudget() }))
    ipcMain.handle(IPC.COST_GET_PRICING, () => ({ success: true, result: cs.getPricing() }))
    ipcMain.handle(IPC.COST_UPDATE_PRICING, (_, tiers) => { cs.updatePricing(tiers); return { success: true, result: cs.getPricing() } })
  }

  // ── 3. Project Knowledge ──
  if (deps.projectKnowledgeService) {
    const kb = deps.projectKnowledgeService
    ipcMain.handle(IPC.PROJECT_KB_CREATE, async (_, p) => kb.createEntry(p))
    ipcMain.handle(IPC.PROJECT_KB_GET, async (_, id) => kb.get(id))
    ipcMain.handle(IPC.PROJECT_KB_UPDATE, async (_, id, updates) => kb.update(id, updates))
    ipcMain.handle(IPC.PROJECT_KB_DELETE, async (_, id) => kb.delete(id))
    ipcMain.handle(IPC.PROJECT_KB_LIST, async (_, path, options?) => kb.list(path, options))
    ipcMain.handle(IPC.PROJECT_KB_ADD_ENTRY, async (_, p) => kb.createEntry(p))
    ipcMain.handle(IPC.PROJECT_KB_REMOVE_ENTRY, async (_, id) => kb.delete(id))
    ipcMain.handle(IPC.PROJECT_KB_SEARCH, async (_, path, q, limit?) => kb.search(path, q, limit))
    ipcMain.handle(IPC.PROJECT_KB_GET_PROMPT, async (_, path) => kb.getPrompt(path))
    ipcMain.handle(IPC.PROJECT_KB_AUTO_EXTRACT, async (_, path) => kb.autoExtract(path))
    ipcMain.handle(IPC.PROJECT_KB_EXTRACT_SESSION, async (_, sessionId, projectPath) => kb.extractFromSession(sessionId, projectPath))
    ipcMain.handle(IPC.PROJECT_KB_DELETE_BATCH, async (_, ids) => kb.deleteBatch(ids))
    ipcMain.handle(IPC.PROJECT_KB_UPDATE_BATCH, async (_, ids, updates) => kb.updateBatch(ids, updates))
    ipcMain.handle(IPC.PROJECT_KB_EXPORT, async (_, path) => kb.exportData(path))
    ipcMain.handle(IPC.PROJECT_KB_IMPORT, async (_, path, data) => kb.importData(path, data))
  }

  // ── 3b. Reference Projects ──
  if (deps.referenceProjectService) {
    const rp = deps.referenceProjectService
    ipcMain.handle(IPC.REFERENCE_SEARCH, async (_, query, language?) =>
      rp.searchRepos(query, language))
    ipcMain.handle(IPC.REFERENCE_REPO_TREE, async (_, owner, repo, branch?) =>
      rp.getRepoTree(owner, repo, branch))
    ipcMain.handle(IPC.REFERENCE_FILE_CONTENT, async (_, owner, repo, filePath, branch?) =>
      rp.getFileContent(owner, repo, filePath, branch))
    ipcMain.handle(IPC.REFERENCE_SAVE_TO_KB, async (_, params) =>
      rp.saveToKnowledge(params))
    ipcMain.handle(IPC.REFERENCE_SAVE, async (_, params) =>
      rp.saveReference(params))
    ipcMain.handle(IPC.REFERENCE_LIST, async (_, projectPath) =>
      rp.listReferences(projectPath))
    ipcMain.handle(IPC.REFERENCE_DELETE, async (_, id) =>
      rp.deleteReference(id))
    ipcMain.handle(IPC.REFERENCE_SUGGEST, async (_, projectPath) =>
      rp.suggestSimilarProjects(projectPath))
  }

  // ── 4. Code Review ──
  if (deps.codeReviewService) {
    const cr = deps.codeReviewService
    ipcMain.handle(IPC.CODE_REVIEW_START, async (_, p) => cr.startReview(p))
    ipcMain.handle(IPC.CODE_REVIEW_GET, async (_, id) => cr.get(id))
    ipcMain.handle(IPC.CODE_REVIEW_LIST, async (_, sessionId?, limit?) => cr.list(sessionId, limit))
    ipcMain.handle(IPC.CODE_REVIEW_GET_COMMENTS, async (_, reviewId) => cr.getComments(reviewId))
    ipcMain.handle(IPC.CODE_REVIEW_RESOLVE_COMMENT, async (_, commentId) => cr.resolveComment(commentId))
    ipcMain.handle(IPC.CODE_REVIEW_APPLY_FIX, async (_, commentId) => cr.applyFix(commentId))
    ipcMain.handle(IPC.CODE_REVIEW_GET_PROMPT, () => cr.getPrompt())
    ipcMain.handle(IPC.CODE_REVIEW_STATUS, () => ({ success: true, enabled: true, settings: cr.getSettings() }))
    ipcMain.handle(IPC.CODE_REVIEW_SETTINGS, (_, updates?) => {
      if (updates) cr.updateSettings(updates)
      return { success: true, settings: cr.getSettings() }
    })
  }

  // ── 5. Session Replay ──
  if (deps.sessionReplayService) {
    const rp = deps.sessionReplayService
    ipcMain.handle(IPC.REPLAY_START_RECORDING, async (_, sid, name) => rp.startRecording(sid, name))
    ipcMain.handle(IPC.REPLAY_STOP_RECORDING, async (_, sid) => rp.stopRecording(sid))
    ipcMain.handle(IPC.REPLAY_GET, async (_, id) => rp.get(id))
    ipcMain.handle(IPC.REPLAY_LIST, async (_, limit?) => rp.list(limit))
    ipcMain.handle(IPC.REPLAY_DELETE, async (_, id) => rp.delete(id))
    ipcMain.handle(IPC.REPLAY_EXPORT, async (_, id) => rp.export(id))
    ipcMain.handle(IPC.REPLAY_GET_EVENTS, async (_, id) => rp.getEvents(id))
    ipcMain.handle(IPC.REPLAY_SETTINGS, (_, updates?) => {
      if (updates) rp.updateSettings(updates)
      return { success: true, settings: rp.getSettings() }
    })
    ipcMain.handle(IPC.REPLAY_IS_RECORDING, (_, sid) => ({ success: true, recording: rp.isRecording(sid) }))
  }

  // ── 6. Context Budget ──
  if (deps.contextBudgetService) {
    const cb = deps.contextBudgetService
    ipcMain.handle(IPC.CONTEXT_BUDGET_GET, async (_, sid) => cb.get(sid))
    ipcMain.handle(IPC.CONTEXT_BUDGET_UPDATE, async (_, updates) => cb.updateConfig(updates))
    ipcMain.handle(IPC.CONTEXT_BUDGET_COMPRESS, async (_, sid) => cb.compress(sid))
    ipcMain.handle(IPC.CONTEXT_BUDGET_MIGRATE, async (_, sid) => cb.migrate(sid))
    ipcMain.handle(IPC.CONTEXT_BUDGET_STATUS, async () => cb.getStatus())
  }

  // ── 7. Battle ──
  if (deps.battleService) {
    const bt = deps.battleService
    ipcMain.handle(IPC.BATTLE_CREATE, async (_, p) => bt.create(p))
    ipcMain.handle(IPC.BATTLE_GET, async (_, id) => bt.get(id))
    ipcMain.handle(IPC.BATTLE_LIST, async (_, limit?) => bt.list(limit))
    ipcMain.handle(IPC.BATTLE_VOTE, async (_, bid, vid, choice, comment?) => bt.vote(bid, vid, choice, comment))
    ipcMain.handle(IPC.BATTLE_DELETE, async (_, id) => bt.delete(id))
    ipcMain.handle(IPC.BATTLE_GET_STATS, async () => bt.getStats())
  }

  // ── 8. Daily Report ──
  if (deps.dailyReportService) {
    const dr = deps.dailyReportService
    ipcMain.handle(IPC.DAILY_REPORT_GENERATE, async (_, date?) => dr.generate(date))
    ipcMain.handle(IPC.DAILY_REPORT_GET, async (_, date) => dr.get(date))
    ipcMain.handle(IPC.DAILY_REPORT_LIST, async (_, limit?) => dr.list(limit))
    ipcMain.handle(IPC.DAILY_REPORT_EXPORT, async (_, date) => dr.export(date))
    ipcMain.handle(IPC.DAILY_REPORT_CONFIG, async (_, updates?) => updates ? dr.setConfig(updates) : dr.getConfig())
    ipcMain.handle(IPC.DAILY_REPORT_DELETE, async (_, date) => dr.delete(date))
  }

  // ── 9. Skill Arena ──
  if (deps.skillArenaService) {
    const sa = deps.skillArenaService
    ipcMain.handle(IPC.SKILL_ARENA_LIST, async (_, cat?, limit?) => sa.list(cat, limit))
    ipcMain.handle(IPC.SKILL_ARENA_SUBMIT, async (_, p) => sa.submit(p))
    ipcMain.handle(IPC.SKILL_ARENA_GET_SCORES, async (_, id) => sa.getScores(id))
    ipcMain.handle(IPC.SKILL_ARENA_GET_LEADERBOARD, async (_, cat?) => sa.getLeaderboard(cat))
    ipcMain.handle(IPC.SKILL_ARENA_VOTE, async (_, id, up) => sa.vote(id, up))
    ipcMain.handle(IPC.SKILL_ARENA_DELETE, async (_, id) => sa.deleteSkill(id))
    ipcMain.handle(IPC.SKILL_ARENA_CATEGORIES, () => sa.getCategories())
    ipcMain.handle(IPC.SKILL_ARENA_GET_STATS, () => sa.getStats())
  }

  // ── 10. Voice ──
  if (deps.voiceService) {
    const vc = deps.voiceService
    ipcMain.handle(IPC.VOICE_START_LISTENING, async () => vc.startListening())
    ipcMain.handle(IPC.VOICE_STOP_LISTENING, async () => vc.stopListening())
    ipcMain.handle(IPC.VOICE_SPEAK, async (_, text) => vc.speak(text))
    ipcMain.handle(IPC.VOICE_GET_STATUS, async () => vc.getStatus())
    ipcMain.handle(IPC.VOICE_GET_CONFIG, async () => vc.getConfig())
    ipcMain.handle(IPC.VOICE_UPDATE_CONFIG, async (_, updates) => vc.updateConfig(updates))
    ipcMain.handle(IPC.VOICE_TRANSCRIBE, async (_, data) => vc.transcribe(data))
    ipcMain.handle(IPC.VOICE_GET_HISTORY, async (_, limit?) => vc.getHistory(limit))
    ipcMain.handle(IPC.VOICE_CLEAR_HISTORY, async () => vc.clearHistory())
    ipcMain.handle(IPC.VOICE_SIMULATE_INPUT, async (_, text) => vc.simulateInput(text))
  }
}
