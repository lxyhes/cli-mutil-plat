/**
 * 记忆相似度去重和版本历史服务
 * 
 * 功能:
 * 1. 基于语义相似度的智能去重（Jaccard + TF-IDF）
 * 2. 记忆版本历史追踪
 * 3. 记忆合并建议
 * 4. 记忆冲突检测
 * 5. 记忆演化分析
 */

import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { MemoryEntry, MemorySignal } from '../cross-session-memory/CrossSessionMemoryService'

// ==================== 类型定义 ====================

export interface SimilarityResult {
  score: number              // 相似度分数 (0-1)
  method: string             // 使用的算法
  details?: Record<string, any>
}

export interface DuplicateCandidate {
  originalId: string
  duplicateId: string
  similarity: SimilarityResult
  recommendation: 'merge' | 'keep_both' | 'replace'
  reason: string
}

export interface MemoryVersion {
  id: string
  memoryId: string           // 原始记忆ID
  version: number            // 版本号
  content: string            // 内容
  keyPoints: string          // 关键点
  keywords: string           // 关键词
  summary: string            // 摘要
  createdAt: string          // 创建时间
  createdBy: string          // 创建者（session ID）
  changeType: 'create' | 'update' | 'merge' | 'split'
  changeReason?: string      // 变更原因
  metadata?: Record<string, any>
}

export interface MergeSuggestion {
  id: string
  memoryIds: string[]        // 要合并的记忆ID列表
  suggestedContent: string   // 建议的合并内容
  confidence: number         // 置信度 (0-1)
  reason: string             // 合并理由
  createdAt: string
}

export interface MemoryConflict {
  id: string
  memoryIds: string[]        // 冲突的记忆ID列表
  conflictType: 'contradiction' | 'outdated' | 'duplicate'
  description: string        // 冲突描述
  severity: 'high' | 'medium' | 'low'
  suggestion?: string        // 解决建议
  detectedAt: string
}

export interface MemoryEvolutionAnalysis {
  memoryId: string
  versions: MemoryVersion[]
  evolutionSummary: string   // 演化总结
  majorChanges: Array<{
    version: number
    changeType: string
    description: string
    timestamp: string
  }>
  stabilityScore: number     // 稳定性评分 (0-1)
}

export interface DeduplicationConfig {
  enabled: boolean
  similarityThreshold: number    // 相似度阈值 (默认 0.85)
  jaccardWeight: number          // Jaccard 权重 (默认 0.4)
  tfidfWeight: number            // TF-IDF 权重 (默认 0.6)
  maxVersionsPerMemory: number   // 每个记忆的最大版本数 (默认 10)
  autoMergeEnabled: boolean      // 是否自动合并 (默认 false)
  checkIntervalMs: number        // 检查间隔 (默认 3600000ms = 1小时)
}

const DEFAULT_CONFIG: DeduplicationConfig = {
  enabled: true,
  similarityThreshold: 0.85,
  jaccardWeight: 0.4,
  tfidfWeight: 0.6,
  maxVersionsPerMemory: 10,
  autoMergeEnabled: false,
  checkIntervalMs: 3600000,
}

// ==================== 核心服务 ====================

export class MemoryDeduplicationService extends EventEmitter {
  private db: DatabaseManager
  private sqliteDb: any = null
  private config: DeduplicationConfig
  private tfidfIndex: Map<string, Map<string, number>> = new Map()  // term -> (memoryId -> tfidf)
  private checkTimer: ReturnType<typeof setInterval> | null = null

  constructor(db: DatabaseManager, config?: Partial<DeduplicationConfig>) {
    super()
    this.db = db
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.sqliteDb = (db as any).db || null
    this.ensureSchema()
    
    if (this.config.enabled && this.config.checkIntervalMs > 0) {
      this.startPeriodicCheck()
    }
  }

  /** 确保数据库表存在 */
  private ensureSchema(): void {
    if (!this.sqliteDb) return
    
    try {
      // 记忆版本历史表
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS memory_versions (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          key_points TEXT DEFAULT '',
          keywords TEXT DEFAULT '',
          summary TEXT DEFAULT '',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_by TEXT DEFAULT '',
          change_type TEXT NOT NULL DEFAULT 'create',
          change_reason TEXT DEFAULT '',
          metadata TEXT DEFAULT '{}'
        )
      `)
      
      this.sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_mv_memory_id ON memory_versions(memory_id)
      `)
      
      this.sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_mv_version ON memory_versions(memory_id, version)
      `)
      
      // 合并建议表
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS merge_suggestions (
          id TEXT PRIMARY KEY,
          memory_ids TEXT NOT NULL,  -- JSON array
          suggested_content TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0,
          reason TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',  -- pending, accepted, rejected
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          reviewed_by TEXT
        )
      `)
      
      // 记忆冲突表
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS memory_conflicts (
          id TEXT PRIMARY KEY,
          memory_ids TEXT NOT NULL,  -- JSON array
          conflict_type TEXT NOT NULL,
          description TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'medium',
          suggestion TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',  -- open, resolved, ignored
          detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME,
          resolved_by TEXT
        )
      `)
      
      console.log('[MemoryDedup] Schema initialized successfully')
    } catch (err) {
      console.error('[MemoryDedup] Schema creation failed:', err)
    }
  }

  /** 启动周期性检查 */
  private startPeriodicCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
    }
    
    this.checkTimer = setInterval(() => {
      this.performDeduplicationCheck().catch(err => {
        console.error('[MemoryDedup] Periodic check failed:', err)
      })
    }, this.config.checkIntervalMs)
    
    console.log(`[MemoryDedup] Periodic check started (interval: ${this.config.checkIntervalMs}ms)`)
  }

  /** 停止周期性检查 */
  stopPeriodicCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
      console.log('[MemoryDedup] Periodic check stopped')
    }
  }

  // ==================== 相似度计算 ====================

  /**
   * 计算两个文本的相似度
   * 使用混合算法：Jaccard + TF-IDF
   */
  calculateSimilarity(text1: string, text2: string): SimilarityResult {
    const jaccardScore = this.calculateJaccardSimilarity(text1, text2)
    const tfidfScore = this.calculateTfidfSimilarity(text1, text2)
    
    const finalScore = (
      jaccardScore * this.config.jaccardWeight +
      tfidfScore * this.config.tfidfWeight
    )
    
    return {
      score: Math.min(1, Math.max(0, finalScore)),
      method: 'jaccard+tfidf',
      details: {
        jaccard: jaccardScore,
        tfidf: tfidfScore,
        weights: {
          jaccard: this.config.jaccardWeight,
          tfidf: this.config.tfidfWeight,
        },
      },
    }
  }

  /**
   * Jaccard 相似度
   * J(A,B) = |A ∩ B| / |A ∪ B|
   */
  private calculateJaccardSimilarity(text1: string, text2: string): number {
    const set1 = new Set(this.tokenize(text1))
    const set2 = new Set(this.tokenize(text2))
    
    if (set1.size === 0 || set2.size === 0) return 0
    
    // 交集
    const intersection = new Set([...set1].filter(x => set2.has(x)))
    
    // 并集
    const union = new Set([...set1, ...set2])
    
    return intersection.size / union.size
  }

  /**
   * TF-IDF 相似度
   * 余弦相似度基于 TF-IDF 向量
   */
  private calculateTfidfSimilarity(text1: string, text2: string): number {
    const tokens1 = this.tokenize(text1)
    const tokens2 = this.tokenize(text2)
    
    if (tokens1.length === 0 || tokens2.length === 0) return 0
    
    // 构建词汇表
    const vocabulary = new Set([...tokens1, ...tokens2])
    
    // 计算 TF (词频)
    const tf1 = this.computeTF(tokens1)
    const tf2 = this.computeTF(tokens2)
    
    // 计算 IDF (逆文档频率) - 简化版，假设只有两个文档
    const idf = this.computeIDF([tokens1, tokens2], vocabulary)
    
    // 计算 TF-IDF 向量
    const vector1 = this.computeTfidfVector(tf1, idf, vocabulary)
    const vector2 = this.computeTfidfVector(tf2, idf, vocabulary)
    
    // 计算余弦相似度
    return this.cosineSimilarity(vector1, vector2)
  }

  /** 分词（中文 + 英文） */
  private tokenize(text: string): string[] {
    // 提取有意义的词（长度 >= 2）
    const words = text.toLowerCase().match(/[a-zA-Z0-9_\u4e00-\u9fff]{2,}/g) || []
    
    // 去除停用词
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'this', 'that',
      'with', 'from', 'have', 'has', 'was', 'were', 'been', 'being', 'is', 'are',
      '的', '了', '是', '在', '和', '有', '不', '这', '我', '他', '她', '它',
      '我们', '他们', '一个', '一些', '什么', '怎么', '如何',
    ])
    
    return words.filter(w => !stopWords.has(w))
  }

  /** 计算词频 (TF) */
  private computeTF(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>()
    const totalTokens = tokens.length
    
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1)
    }
    
    // 归一化
    for (const [term, count] of tf.entries()) {
      tf.set(term, count / totalTokens)
    }
    
    return tf
  }

  /** 计算逆文档频率 (IDF) */
  private computeIDF(documents: string[][], vocabulary: Set<string>): Map<string, number> {
    const idf = new Map<string, number>()
    const numDocs = documents.length
    
    for (const term of vocabulary) {
      // 计算包含该词的文档数
      const docCount = documents.filter(doc => doc.includes(term)).length
      
      // IDF = log(N / df) + 1 (平滑)
      idf.set(term, Math.log(numDocs / (docCount + 1)) + 1)
    }
    
    return idf
  }

  /** 计算 TF-IDF 向量 */
  private computeTfidfVector(
    tf: Map<string, number>,
    idf: Map<string, number>,
    vocabulary: Set<string>
  ): Map<string, number> {
    const vector = new Map<string, number>()
    
    for (const term of vocabulary) {
      const tfValue = tf.get(term) || 0
      const idfValue = idf.get(term) || 0
      vector.set(term, tfValue * idfValue)
    }
    
    return vector
  }

  /** 计算余弦相似度 */
  private cosineSimilarity(
    vector1: Map<string, number>,
    vector2: Map<string, number>
  ): number {
    let dotProduct = 0
    let norm1 = 0
    let norm2 = 0
    
    // 获取所有维度
    const allTerms = new Set([...vector1.keys(), ...vector2.keys()])
    
    for (const term of allTerms) {
      const v1 = vector1.get(term) || 0
      const v2 = vector2.get(term) || 0
      
      dotProduct += v1 * v2
      norm1 += v1 * v1
      norm2 += v2 * v2
    }
    
    if (norm1 === 0 || norm2 === 0) return 0
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2))
  }

  // ==================== 去重检测 ====================

  /**
   * 检测重复记忆
   * @param newMemory 新记忆
   * @param existingMemories 现有记忆列表
   * @returns 重复候选列表
   */
  detectDuplicates(
    newMemory: MemoryEntry | MemorySignal,
    existingMemories: MemoryEntry[]
  ): DuplicateCandidate[] {
    const candidates: DuplicateCandidate[] = []
    
    const newText = `${newMemory.summary || ''} ${newMemory.keyPoints || ''}`
    
    for (const existing of existingMemories) {
      const existingText = `${existing.summary || ''} ${existing.keyPoints || ''}`
      
      const similarity = this.calculateSimilarity(newText, existingText)
      
      if (similarity.score >= this.config.similarityThreshold) {
        // 判断推荐操作
        let recommendation: 'merge' | 'keep_both' | 'replace' = 'keep_both'
        let reason = ''
        
        if (similarity.score >= 0.95) {
          recommendation = 'merge'
          reason = '极高相似度，建议合并'
        } else if (similarity.score >= 0.9) {
          recommendation = 'replace'
          reason = '高度相似，建议替换旧版本'
        } else {
          recommendation = 'keep_both'
          reason = '中度相似，保留两者但标记关联'
        }
        
        candidates.push({
          originalId: existing.id,
          duplicateId: 'id' in newMemory ? newMemory.id : newMemory.sessionId,
          similarity,
          recommendation,
          reason,
        })
      }
    }
    
    return candidates.sort((a, b) => b.similarity.score - a.similarity.score)
  }

  /**
   * 执行全量去重检查
   */
  async performDeduplicationCheck(): Promise<DuplicateCandidate[]> {
    if (!this.sqliteDb) return []
    
    try {
      // 获取所有记忆
      const memories = this.sqliteDb.prepare(`
        SELECT * FROM cross_session_memory
        ORDER BY created_at DESC
      `).all() as any[]
      
      const allCandidates: DuplicateCandidate[] = []
      const checkedPairs = new Set<string>()
      
      // 两两比较
      for (let i = 0; i < memories.length; i++) {
        for (let j = i + 1; j < memories.length; j++) {
          const mem1 = memories[i]
          const mem2 = memories[j]
          
          // 避免重复检查
          const pairKey = [mem1.id, mem2.id].sort().join('-')
          if (checkedPairs.has(pairKey)) continue
          checkedPairs.add(pairKey)
          
          const text1 = `${mem1.summary} ${mem1.key_points}`
          const text2 = `${mem2.summary} ${mem2.key_points}`
          
          const similarity = this.calculateSimilarity(text1, text2)
          
          if (similarity.score >= this.config.similarityThreshold) {
            allCandidates.push({
              originalId: mem1.id,
              duplicateId: mem2.id,
              similarity,
              recommendation: similarity.score >= 0.95 ? 'merge' : 'keep_both',
              reason: `相似度 ${(similarity.score * 100).toFixed(1)}%`,
            })
          }
        }
      }
      
      // 保存检测结果
      for (const candidate of allCandidates) {
        this.saveDuplicateCandidate(candidate)
      }
      
      this.emit('deduplication-check-completed', {
        totalMemories: memories.length,
        duplicatesFound: allCandidates.length,
        candidates: allCandidates,
      })
      
      return allCandidates
    } catch (err) {
      console.error('[MemoryDedup] Deduplication check failed:', err)
      return []
    }
  }

  /** 保存重复候选记录 */
  private saveDuplicateCandidate(candidate: DuplicateCandidate): void {
    if (!this.sqliteDb) return
    
    try {
      const id = `dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      
      this.sqliteDb.prepare(`
        INSERT INTO memory_conflicts (id, memory_ids, conflict_type, description, severity, suggestion)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        JSON.stringify([candidate.originalId, candidate.duplicateId]),
        'duplicate',
        candidate.reason,
        candidate.similarity.score >= 0.95 ? 'high' : 'medium',
        `建议: ${candidate.recommendation}`,
      )
    } catch (err) {
      console.error('[MemoryDedup] Failed to save duplicate candidate:', err)
    }
  }

  // ==================== 版本历史 ====================

  /**
   * 创建记忆版本
   */
  createMemoryVersion(
    memoryId: string,
    content: string,
    keyPoints: string,
    keywords: string,
    summary: string,
    createdBy: string,
    changeType: MemoryVersion['changeType'] = 'update',
    changeReason?: string,
    metadata?: Record<string, any>
  ): MemoryVersion | null {
    if (!this.sqliteDb) return null
    
    try {
      // 获取当前最大版本号
      const lastVersion = this.sqliteDb.prepare(`
        SELECT MAX(version) as max_version FROM memory_versions WHERE memory_id = ?
      `).get(memoryId) as any
      
      const nextVersion = (lastVersion?.max_version || 0) + 1
      
      const id = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      
      this.sqliteDb.prepare(`
        INSERT INTO memory_versions (
          id, memory_id, version, content, key_points, keywords, summary,
          created_at, created_by, change_type, change_reason, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, memoryId, nextVersion,
        content, keyPoints, keywords, summary,
        new Date().toISOString(), createdBy,
        changeType, changeReason || '',
        JSON.stringify(metadata || {}),
      )
      
      const version: MemoryVersion = {
        id,
        memoryId,
        version: nextVersion,
        content,
        keyPoints,
        keywords,
        summary,
        createdAt: new Date().toISOString(),
        createdBy,
        changeType,
        changeReason,
        metadata,
      }
      
      this.emit('version-created', version)
      
      // 清理旧版本（如果超过限制）
      this.cleanupOldVersions(memoryId)
      
      return version
    } catch (err) {
      console.error('[MemoryDedup] Failed to create version:', err)
      return null
    }
  }

  /**
   * 获取记忆的版本历史
   */
  getMemoryVersions(memoryId: string, limit?: number): MemoryVersion[] {
    if (!this.sqliteDb) return []
    
    try {
      const query = limit
        ? `SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version DESC LIMIT ?`
        : `SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version DESC`
      
      const rows = this.sqliteDb.prepare(query).all(memoryId, limit) as any[]
      
      return rows.map(row => ({
        id: row.id,
        memoryId: row.memory_id,
        version: row.version,
        content: row.content,
        keyPoints: row.key_points,
        keywords: row.keywords,
        summary: row.summary,
        createdAt: row.created_at,
        createdBy: row.created_by,
        changeType: row.change_type,
        changeReason: row.change_reason,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      }))
    } catch (err) {
      console.error('[MemoryDedup] Failed to get versions:', err)
      return []
    }
  }

  /**
   * 获取记忆的演化分析
   */
  analyzeMemoryEvolution(memoryId: string): MemoryEvolutionAnalysis | null {
    const versions = this.getMemoryVersions(memoryId)
    
    if (versions.length === 0) return null
    
    // 识别重大变更
    const majorChanges: Array<{
      version: number
      changeType: string
      description: string
      timestamp: string
    }> = []
    
    for (let i = 1; i < versions.length; i++) {
      const current = versions[i]
      const previous = versions[i - 1]
      
      // 计算版本间差异
      const contentDiff = this.calculateTextDifference(previous.content, current.content)
      
      if (contentDiff > 0.3 || current.changeType !== 'update') {
        majorChanges.push({
          version: current.version,
          changeType: current.changeType,
          description: current.changeReason || `内容变化 ${(contentDiff * 100).toFixed(0)}%`,
          timestamp: current.createdAt,
        })
      }
    }
    
    // 计算稳定性评分（版本越多、变化越大，稳定性越低）
    const stabilityScore = this.calculateStabilityScore(versions)
    
    // 生成演化总结
    const evolutionSummary = this.generateEvolutionSummary(versions, majorChanges)
    
    return {
      memoryId,
      versions,
      evolutionSummary,
      majorChanges,
      stabilityScore,
    }
  }

  /** 计算文本差异比例 */
  private calculateTextDifference(text1: string, text2: string): number {
    const similarity = this.calculateSimilarity(text1, text2)
    return 1 - similarity.score
  }

  /** 计算稳定性评分 */
  private calculateStabilityScore(versions: MemoryVersion[]): number {
    if (versions.length <= 1) return 1.0
    
    // 基于版本数量和变化幅度计算
    const versionCount = versions.length
    const timeSpan = new Date(versions[0].createdAt).getTime() - 
                     new Date(versions[versions.length - 1].createdAt).getTime()
    
    // 版本越密集，稳定性越低
    const densityFactor = versionCount / (timeSpan / 86400000 + 1)  // 每天版本数
    
    // 标准化到 0-1
    return Math.max(0, Math.min(1, 1 - densityFactor * 0.5))
  }

  /** 生成演化总结 */
  private generateEvolutionSummary(
    versions: MemoryVersion[],
    majorChanges: Array<{ version: number; changeType: string; description: string }>
  ): string {
    const parts: string[] = []
    
    parts.push(`该记忆共有 ${versions.length} 个版本`)
    
    if (majorChanges.length > 0) {
      parts.push(`经历 ${majorChanges.length} 次重大变更`)
      parts.push(`最新变更: ${majorChanges[0].description}`)
    }
    
    const latestVersion = versions[0]
    parts.push(`当前版本: v${latestVersion.version} (${latestVersion.changeType})`)
    
    return parts.join('；')
  }

  /** 清理旧版本 */
  private cleanupOldVersions(memoryId: string): void {
    if (!this.sqliteDb) return
    
    try {
      // 保留最新的 N 个版本
      this.sqliteDb.prepare(`
        DELETE FROM memory_versions
        WHERE memory_id = ?
          AND version NOT IN (
            SELECT version FROM memory_versions
            WHERE memory_id = ?
            ORDER BY version DESC
            LIMIT ?
          )
      `).run(memoryId, memoryId, this.config.maxVersionsPerMemory)
    } catch (err) {
      console.error('[MemoryDedup] Failed to cleanup old versions:', err)
    }
  }

  // ==================== 合并建议 ====================

  /**
   * 生成合并建议
   */
  generateMergeSuggestion(memoryIds: string[]): MergeSuggestion | null {
    if (!this.sqliteDb || memoryIds.length < 2) return null
    
    try {
      // 获取所有记忆
      const memories = memoryIds.map(id => {
        return this.sqliteDb.prepare(
          'SELECT * FROM cross_session_memory WHERE id = ?'
        ).get(id) as any
      }).filter(Boolean)
      
      if (memories.length < 2) return null
      
      // 合并内容（去重 + 整合）
      const allSummaries = memories.map(m => m.summary).filter(Boolean)
      const allKeyPoints = memories.map(m => m.key_points).filter(Boolean)
      
      const mergedContent = this.consolidateContent(allSummaries, allKeyPoints)
      
      // 计算置信度
      const similarities: number[] = []
      for (let i = 0; i < memories.length; i++) {
        for (let j = i + 1; j < memories.length; j++) {
          const text1 = `${memories[i].summary} ${memories[i].key_points}`
          const text2 = `${memories[j].summary} ${memories[j].key_points}`
          const sim = this.calculateSimilarity(text1, text2)
          similarities.push(sim.score)
        }
      }
      
      const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length
      const confidence = avgSimilarity
      
      const id = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      
      const suggestion: MergeSuggestion = {
        id,
        memoryIds,
        suggestedContent: mergedContent,
        confidence,
        reason: `平均相似度 ${(confidence * 100).toFixed(1)}%，建议合并以减少冗余`,
        createdAt: new Date().toISOString(),
      }
      
      // 保存到数据库
      this.sqliteDb.prepare(`
        INSERT INTO merge_suggestions (id, memory_ids, suggested_content, confidence, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        JSON.stringify(memoryIds),
        mergedContent,
        confidence,
        suggestion.reason,
      )
      
      this.emit('merge-suggestion-created', suggestion)
      
      return suggestion
    } catch (err) {
      console.error('[MemoryDedup] Failed to generate merge suggestion:', err)
      return null
    }
  }

  /** 合并内容（启发式） */
  private consolidateContent(summaries: string[], keyPoints: string[]): string {
    // 简单策略：取最长的摘要作为基础，追加其他摘要的独特部分
    if (summaries.length === 0) return ''
    if (summaries.length === 1) return summaries[0]
    
    // 找到最长的摘要
    const baseSummary = summaries.reduce((longest, current) =>
      current.length > longest.length ? current : longest
    )
    
    // 收集独特的句子
    const uniqueSentences: string[] = [baseSummary]
    
    for (const summary of summaries) {
      if (summary === baseSummary) continue
      
      const sentences = summary.split(/[。；.!?！？\n]/).map(s => s.trim()).filter(s => s.length > 10)
      
      for (const sentence of sentences) {
        const isDuplicate = uniqueSentences.some(existing =>
          this.calculateSimilarity(existing, sentence).score > 0.7
        )
        
        if (!isDuplicate) {
          uniqueSentences.push(sentence)
        }
      }
    }
    
    return uniqueSentences.join('\n\n')
  }

  /** 获取待处理的合并建议 */
  getPendingMergeSuggestions(limit = 10): MergeSuggestion[] {
    if (!this.sqliteDb) return []
    
    try {
      const rows = this.sqliteDb.prepare(`
        SELECT * FROM merge_suggestions
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit) as any[]
      
      return rows.map(row => ({
        id: row.id,
        memoryIds: JSON.parse(row.memory_ids),
        suggestedContent: row.suggested_content,
        confidence: row.confidence,
        reason: row.reason,
        createdAt: row.created_at,
      }))
    } catch (err) {
      console.error('[MemoryDedup] Failed to get pending suggestions:', err)
      return []
    }
  }

  /** 接受合并建议 */
  acceptMergeSuggestion(suggestionId: string): boolean {
    if (!this.sqliteDb) return false
    
    try {
      const suggestion = this.sqliteDb.prepare(
        'SELECT * FROM merge_suggestions WHERE id = ?'
      ).get(suggestionId) as any
      
      if (!suggestion) return false
      
      const memoryIds: string[] = JSON.parse(suggestion.memory_ids)
      
      // TODO: 实际执行合并逻辑
      // 1. 创建新的合并后记忆
      // 2. 标记旧记忆为已合并
      // 3. 更新建议状态
      
      this.sqliteDb.prepare(`
        UPDATE merge_suggestions
        SET status = 'accepted', reviewed_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), suggestionId)
      
      this.emit('merge-suggestion-accepted', suggestionId)
      
      return true
    } catch (err) {
      console.error('[MemoryDedup] Failed to accept merge suggestion:', err)
      return false
    }
  }

  /** 拒绝合并建议 */
  rejectMergeSuggestion(suggestionId: string): boolean {
    if (!this.sqliteDb) return false
    
    try {
      this.sqliteDb.prepare(`
        UPDATE merge_suggestions
        SET status = 'rejected', reviewed_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), suggestionId)
      
      this.emit('merge-suggestion-rejected', suggestionId)
      
      return true
    } catch (err) {
      console.error('[MemoryDedup] Failed to reject merge suggestion:', err)
      return false
    }
  }

  // ==================== 配置管理 ====================

  /** 更新配置 */
  updateConfig(updates: Partial<DeduplicationConfig>): void {
    this.config = { ...this.config, ...updates }
    
    // 如果启用了周期性检查
    if (this.config.enabled && this.config.checkIntervalMs > 0) {
      this.startPeriodicCheck()
    } else {
      this.stopPeriodicCheck()
    }
    
    this.emit('config-updated', this.config)
  }

  /** 获取配置 */
  getConfig(): DeduplicationConfig {
    return { ...this.config }
  }

  // ==================== 统计信息 ====================

  /** 获取统计信息 */
  getStats(): {
    totalMemories: number
    totalVersions: number
    pendingSuggestions: number
    openConflicts: number
    averageVersionsPerMemory: number
  } {
    if (!this.sqliteDb) {
      return {
        totalMemories: 0,
        totalVersions: 0,
        pendingSuggestions: 0,
        openConflicts: 0,
        averageVersionsPerMemory: 0,
      }
    }
    
    try {
      const totalMemories = this.sqliteDb.prepare(
        'SELECT COUNT(*) as count FROM cross_session_memory'
      ).get() as any
      
      const totalVersions = this.sqliteDb.prepare(
        'SELECT COUNT(*) as count FROM memory_versions'
      ).get() as any
      
      const pendingSuggestions = this.sqliteDb.prepare(
        "SELECT COUNT(*) as count FROM merge_suggestions WHERE status = 'pending'"
      ).get() as any
      
      const openConflicts = this.sqliteDb.prepare(
        "SELECT COUNT(*) as count FROM memory_conflicts WHERE status = 'open'"
      ).get() as any
      
      return {
        totalMemories: totalMemories.count || 0,
        totalVersions: totalVersions.count || 0,
        pendingSuggestions: pendingSuggestions.count || 0,
        openConflicts: openConflicts.count || 0,
        averageVersionsPerMemory: totalMemories.count > 0
          ? totalVersions.count / totalMemories.count
          : 0,
      }
    } catch (err) {
      console.error('[MemoryDedup] Failed to get stats:', err)
      return {
        totalMemories: 0,
        totalVersions: 0,
        pendingSuggestions: 0,
        openConflicts: 0,
        averageVersionsPerMemory: 0,
      }
    }
  }

  /** 销毁服务 */
  destroy(): void {
    this.stopPeriodicCheck()
    this.removeAllListeners()
  }
}
