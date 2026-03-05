/**
 * Orchestration Skill 引擎 - 处理多 Provider 协作的编排技能
 * @author weibin
 */
import type { Skill, OrchestrationStep } from '../../shared/types'

export class OrchestrationSkillEngine {
  /**
   * 执行编排技能
   * 按步骤依赖关系排序，依次调用不同 Provider 的子会话，最后合并结果
   *
   * @param skill - Orchestration Skill 定义
   * @param parentSessionId - 父会话 ID
   * @param sessionManager - SessionManagerV2 实例（用于 injectMessage）
   * @param agentManager - AgentManagerV2 实例（用于创建子会话）
   * @param userInput - 用户输入
   * @param variables - 已解析的变量
   */
  static async execute(
    skill: Skill,
    parentSessionId: string,
    sessionManager: any,
    agentManager: any,
    userInput: string,
    variables?: Record<string, string>,
  ): Promise<void> {
    if (!skill.orchestrationConfig) {
      console.error(`[OrchestrationSkillEngine] Skill ${skill.id} has no orchestrationConfig`)
      return
    }

    const { steps, mergeStrategy, outputFormat } = skill.orchestrationConfig
    const stepResults = new Map<string, string>()

    console.log(`[OrchestrationSkillEngine] 执行技能 '${skill.name}'，共 ${steps.length} 步`)

    // 拓扑排序
    const sortedSteps = this.topologicalSort(steps)

    for (const step of sortedSteps) {
      // 展开提示词
      let prompt = step.promptTemplate

      // 替换用户输入
      prompt = prompt.replace(/\{\{user_input\}\}/g, userInput)
      prompt = prompt.replace(/\{\{input\}\}/g, userInput)

      // 替换依赖步骤的输出
      if (step.dependsOn?.length) {
        for (const depName of step.dependsOn) {
          const depResult = stepResults.get(depName) || ''
          prompt = prompt.replace(new RegExp(`\\{\\{${depName}_output\\}\\}`, 'g'), depResult)
          prompt = prompt.replace(/\{\{prev_output\}\}/g, depResult)
        }
      }

      // 替换变量
      if (variables) {
        for (const [k, v] of Object.entries(variables)) {
          prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
        }
      }

      try {
        console.log(`[OrchestrationSkillEngine] 执行步骤 '${step.name}'，Provider: '${step.providerId}'`)

        // 通过 AgentManagerV2 创建一次性子会话
        let result = ''
        if (agentManager && typeof agentManager.spawnOneshotAgent === 'function') {
          const agentResult = await agentManager.spawnOneshotAgent({
            name: `[${skill.name}] ${step.name}`,
            prompt,
            providerId: step.providerId,
            parentSessionId,
            timeout: step.timeout || 300000,
          })
          result = agentResult?.output || ''
        } else {
          // AgentManager 不支持 spawnOneshotAgent，记录警告
          console.warn(`[OrchestrationSkillEngine] AgentManager 不支持 spawnOneshotAgent，步骤 '${step.name}' 已跳过`)
          result = `[步骤 ${step.name} 未执行：AgentManager 不支持]`
        }

        stepResults.set(step.name, result)
      } catch (err) {
        console.error(`[OrchestrationSkillEngine] 步骤 '${step.name}' 执行失败:`, err)
        stepResults.set(step.name, `[步骤 ${step.name} 执行失败: ${(err as Error).message}]`)
      }
    }

    // 合并结果
    const allResults = sortedSteps.map(s => stepResults.get(s.name) || '')
    const merged = this.mergeResults(allResults, mergeStrategy)

    // 将结果注入父会话
    const resultMessage = [
      `**[技能：${skill.name}] 执行完成**`,
      '',
      merged,
      outputFormat ? `\n---\n*格式要求：${outputFormat}*` : '',
    ].filter(Boolean).join('\n')

    try {
      if (typeof sessionManager.injectSystemMessage === 'function') {
        await sessionManager.injectSystemMessage(parentSessionId, resultMessage)
      } else {
        // fallback：直接发送消息
        await sessionManager.sendMessage(parentSessionId, resultMessage)
      }
    } catch (err) {
      console.error(`[OrchestrationSkillEngine] 向会话 ${parentSessionId} 注入结果失败:`, err)
    }
  }

  /**
   * Kahn's 算法拓扑排序
   */
  private static topologicalSort(steps: OrchestrationStep[]): OrchestrationStep[] {
    const inDegree = new Map(steps.map(s => [s.name, 0]))

    // 计算入度
    for (const step of steps) {
      for (const _dep of (step.dependsOn || [])) {
        inDegree.set(step.name, (inDegree.get(step.name) || 0) + 1)
      }
    }

    const queue = steps.filter(s => (inDegree.get(s.name) || 0) === 0)
    const sorted: OrchestrationStep[] = []

    while (queue.length > 0) {
      const current = queue.shift()!
      sorted.push(current)

      // 找到依赖 current 的步骤，减少入度
      for (const step of steps) {
        if (step.dependsOn?.includes(current.name)) {
          const newDegree = (inDegree.get(step.name) || 0) - 1
          inDegree.set(step.name, newDegree)
          if (newDegree === 0) {
            queue.push(step)
          }
        }
      }
    }

    // 如果有环，按原顺序返回剩余步骤
    const remaining = steps.filter(s => !sorted.includes(s))
    return [...sorted, ...remaining]
  }

  /**
   * 合并多个步骤的输出
   */
  private static mergeResults(
    results: string[],
    strategy: NonNullable<Skill['orchestrationConfig']>['mergeStrategy'],
  ): string {
    const nonEmpty = results.filter(r => r.trim())

    switch (strategy) {
      case 'concatenate':
        return nonEmpty.join('\n\n---\n\n')

      case 'last':
        return nonEmpty[nonEmpty.length - 1] || ''

      case 'vote':
        // 简化版投票：返回最详细（最长）的结果
        return nonEmpty.sort((a, b) => b.length - a.length)[0] || ''

      case 'llm-summarize':
        // 暂时 fallback 到 concatenate（完整 LLM 摘要需要独立 API 调用）
        return nonEmpty.join('\n\n---\n\n')

      default:
        return nonEmpty.join('\n\n')
    }
  }
}
