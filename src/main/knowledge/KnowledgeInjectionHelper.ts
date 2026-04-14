/**
 * 统一知识注入辅助函数
 * 供 SessionManagerV2 和其他模块调用,避免知识库和记忆重复注入
 * 
 * @author spectrai
 */
import type { KnowledgeCenterService } from '../knowledge/KnowledgeCenterService'

interface InjectKnowledgeOptions {
  projectPath?: string        // 项目路径(用于项目级知识)
  sessionId?: string          // 会话ID(用于工作记忆)
  sessionGoal?: string        // 会话目标(用于匹配跨会话记忆)
  maxLength?: number          // 总最大长度限制(默认8000)
}

interface InjectKnowledgeResult {
  prompt: string              // 生成的注入提示
  totalLength: number         // 总长度
  injectedCount: number       // 注入的知识条目数量
  sections: {                 // 各部分详情
    projectKnowledge?: { count: number; length: number }
    crossSessionMemory?: { length: number }
    workingMemory?: { length: number }
  }
}

/**
 * 统一注入知识
 * 按优先级和长度限制组合:
 * 1. 项目知识库(项目级+持久)
 * 2. 跨会话记忆(全局级+持久)
 * 3. 工作记忆(项目级+临时)
 */
export async function injectKnowledge(
  knowledgeCenterService: KnowledgeCenterService,
  options: InjectKnowledgeOptions
): Promise<InjectKnowledgeResult> {
  const { projectPath, sessionId, sessionGoal, maxLength = 8000 } = options

  // 使用 KnowledgeCenterService 的统一注入方法
  const result = await knowledgeCenterService.generateInjectionPrompt(
    projectPath || '',
    sessionGoal,
    sessionId
  )

  // 统计各部分信息
  const sections: InjectKnowledgeResult['sections'] = {}
  
  const projectKnowledgeEntries = result.injectedEntries.filter(e => e.type === 'project-knowledge')
  if (projectKnowledgeEntries.length > 0) {
    sections.projectKnowledge = {
      count: projectKnowledgeEntries.length,
      length: result.totalLength
    }
  }

  // 简单估算(实际长度会在最终 prompt 中体现)
  if (result.injectedEntries.some(e => e.type === 'cross-session-memory')) {
    sections.crossSessionMemory = { length: 0 } // 实际长度包含在 totalLength 中
  }
  
  if (result.injectedEntries.some(e => e.type === 'working-memory')) {
    sections.workingMemory = { length: 0 } // 实际长度包含在 totalLength 中
  }

  return {
    prompt: result.prompt,
    totalLength: result.totalLength,
    injectedCount: result.injectedEntries.length,
    sections
  }
}

/**
 * 智能去重注入
 * 当同时有多种知识类型时,避免内容重复
 */
export async function injectKnowledgeDeduplicated(
  knowledgeCenterService: KnowledgeCenterService,
  options: InjectKnowledgeOptions
): Promise<InjectKnowledgeResult> {
  const result = await injectKnowledge(knowledgeCenterService, options)

  // 如果启用了去重,KnowledgeCenterService 内部已处理
  // 这里可以添加额外的去重逻辑(如需要)

  return result
}
