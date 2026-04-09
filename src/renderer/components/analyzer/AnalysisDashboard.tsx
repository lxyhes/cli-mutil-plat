/**
 * 多维度专家分析 - 主面板组件
 * 
 * 展示 4 个专家的分析结果汇总和行动清单
 * 
 * @author weibin
 */

import { useState, useEffect } from 'react'
import { Shield, Code, Zap, GitBranch, AlertTriangle, CheckCircle, XCircle, ArrowRight } from 'lucide-react'

/** 专家类型配置 */
const EXPERT_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  code_quality: { icon: <Code size={18} />, color: 'text-blue-500', label: '代码质量' },
  performance: { icon: <Zap size={18} />, color: 'text-yellow-500', label: '性能工程' },
  security: { icon: <Shield size={18} />, color: 'text-red-500', label: '安全审计' },
  architecture: { icon: <GitBranch size={18} />, color: 'text-purple-500', label: '架构评估' },
}

export default function AnalysisDashboard() {
  const [analyzing, setAnalyzing] = useState(false)
  const [report, setReport] = useState<any>(null)

  const handleStartAnalysis = async () => {
    setAnalyzing(true)
    try {
      // TODO: 调用 IPC 启动分析
      // const result = await window.spectrAI.analyzer.startAnalysis({ workDir, sessionId })
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent-blue" />
          <span className="text-sm font-semibold text-text-primary">多维度专家分析</span>
        </div>
        <button
          onClick={handleStartAnalysis}
          disabled={analyzing}
          className="px-3 py-1.5 text-xs font-medium bg-accent-blue text-white rounded-lg
            hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {analyzing ? '分析中...' : '开始分析'}
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {!report ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Shield className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-sm">点击"开始分析"启动多维度代码审查</p>
            <p className="text-xs mt-1 opacity-60">包含代码质量、性能、安全、架构 4 个维度</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 总体评分 */}
            <div className="p-4 bg-bg-secondary rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">总体评分</span>
                <span className={`text-2xl font-bold ${getScoreColor(report.overallScore)}`}>
                  {report.overallScore}/100
                </span>
              </div>
            </div>

            {/* 4 个专家卡片 */}
            <div className="grid grid-cols-2 gap-3">
              {report.expertResults?.map((result: any) => {
                const config = EXPERT_CONFIG[result.expert]
                if (!config) return null
                return (
                  <div key={result.expert} className="p-3 bg-bg-secondary rounded-lg border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={config.color}>{config.icon}</span>
                      <span className="text-xs font-medium text-text-primary">{config.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-red-500">
                        <AlertTriangle size={12} className="inline mr-1" />
                        {result.stats?.critical || 0}
                      </span>
                      <span className="text-yellow-500">
                        <AlertTriangle size={12} className="inline mr-1" />
                        {result.stats?.high || 0}
                      </span>
                      <span className="text-blue-500">
                        <AlertTriangle size={12} className="inline mr-1" />
                        {result.stats?.medium || 0}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 行动清单 */}
            {report.actionItems?.length > 0 && (
              <div className="p-4 bg-bg-secondary rounded-lg border border-border">
                <h3 className="text-sm font-medium text-text-primary mb-3">行动清单</h3>
                <div className="space-y-2">
                  {report.actionItems.map((item: any) => (
                    <div key={item.id} className="flex items-start gap-2 p-2 bg-bg-primary rounded">
                      <ArrowRight size={14} className="text-accent-blue mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text-primary truncate">{item.title}</p>
                        <p className="text-[10px] text-text-muted mt-0.5">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-500'
  if (score >= 60) return 'text-yellow-500'
  return 'text-red-500'
}
