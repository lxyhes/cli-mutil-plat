/**
 * 项目快速上手组件
 *
 * 引导新用户快速了解项目的基本功能和使用方法
 *
 * @author weibin
 */

import React, { useState } from 'react'
import { ArrowRight, Check, X, Bot, FolderTree, GitBranch, Users, BarChart2, Wrench, BookMarked, Mic, Sparkles, FileText, ShieldCheck, Gauge } from 'lucide-react'

interface Step {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  image: string
  tips: string[]
}

const QuickStartGuide: React.FC<{
  onClose: () => void
}> = ({ onClose }) => {
  const [currentStep, setCurrentStep] = useState(0)

  const steps: Step[] = [
    {
      id: 'welcome',
      title: '欢迎使用 SpectrAI',
      description: 'SpectrAI 是一个强大的 AI 辅助开发工具，帮助您更高效地进行开发工作。',
      icon: <Bot className="w-8 h-8 text-accent-blue" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=modern%20AI%20assistant%20interface%20with%20chat%20interface&image_size=landscape_16_9',
      tips: [
        '创建新会话开始与 AI 对话',
        '使用 / 命令访问各种功能',
        '拖拽文件到输入框进行分析'
      ]
    },
    {
      id: 'explorer',
      title: '文件管理',
      description: '浏览和管理项目文件，支持代码编辑和文件操作。',
      icon: <FolderTree className="w-8 h-8 text-accent-green" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=code%20editor%20with%20file%20explorer%20interface&image_size=landscape_16_9',
      tips: [
        '点击文件树浏览项目结构',
        '双击文件打开编辑器',
        '使用 @ 符号快速引用文件'
      ]
    },
    {
      id: 'git',
      title: 'Git 集成',
      description: '直接在界面中查看 Git 状态和提交历史。',
      icon: <GitBranch className="w-8 h-8 text-accent-yellow" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=git%20interface%20with%20commit%20history&image_size=landscape_16_9',
      tips: [
        '查看当前分支和状态',
        '查看提交历史',
        '使用 /commit 命令快速提交'
      ]
    },
    {
      id: 'team',
      title: '团队协作',
      description: '与团队成员共享会话和任务，提高协作效率。',
      icon: <Users className="w-8 h-8 text-accent-purple" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=team%20collaboration%20interface%20with%20chat%20and%20tasks&image_size=landscape_16_9',
      tips: [
        '创建团队会话',
        共享任务和进度',
        '实时协作编辑'
      ]
    },
    {
      id: 'dashboard',
      title: '数据看板',
      description: '查看项目统计数据和使用情况。',
      icon: <BarChart2 className="w-8 h-8 text-accent-red" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=dashboard%20interface%20with%20charts%20and%20statistics&image_size=landscape_16_9',
      tips: [
        '查看使用统计',
        '分析会话数据',
        '监控项目进度'
      ]
    },
    {
      id: 'toolbox',
      title: '工具箱',
      description: '访问各种高级功能和工具。',
      icon: <Wrench className="w-8 h-8 text-accent-blue" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=toolbox%20interface%20with%20various%20tools%20and%20features&image_size=landscape_16_9',
      tips: [
        '提示词优化',
        '会话摘要',
        '语音交互',
        '代码审查',
        '上下文预算',
        '知识中心'
      ]
    },
    {
      id: 'knowledge',
      title: '知识中心',
      description: '管理项目知识库和工作记忆。',
      icon: <BookMarked className="w-8 h-8 text-accent-purple" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=knowledge%20base%20interface%20with%20documents%20and%20categories&image_size=landscape_16_9',
      tips: [
        '添加知识条目',
        '搜索知识库',
        '管理工作记忆'
      ]
    },
    {
      id: 'voice',
      title: '语音交互',
      description: '使用语音输入和 TTS 播报功能。',
      icon: <Mic className="w-8 h-8 text-accent-green" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=voice%20recognition%20interface%20with%20microphone%20icon&image_size=landscape_16_9',
      tips: [
        '点击麦克风按钮开始语音输入',
        '支持中英文混合识别',
        '使用 TTS 播报 AI 回复'
      ]
    },
    {
      id: 'tips',
      title: '使用技巧',
      description: '掌握这些技巧，让您的使用体验更加高效。',
      icon: <Sparkles className="w-8 h-8 text-accent-yellow" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=productivity%20tips%20interface%20with%20shortcuts%20and%20hints&image_size=landscape_16_9',
      tips: [
        '使用 Ctrl+F 搜索会话内容',
        '使用 /model 命令切换模型',
        '使用 @ 符号快速引用文件',
        '使用拖拽功能添加文件',
        '使用右键菜单复制消息内容'
      ]
    },
    {
      id: 'finish',
      title: '开始使用',
      description: '您已经了解了 SpectrAI 的基本功能，现在开始您的 AI 辅助开发之旅吧！',
      icon: <Check className="w-8 h-8 text-accent-green" />,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=welcome%20screen%20with%20start%20button%20and%20positive%20message&image_size=landscape_16_9',
      tips: [
        '创建新会话开始与 AI 对话',
        '探索工具箱中的高级功能',
        '与团队成员一起协作开发'
      ]
    }
  ]

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      onClose()
    }
  }

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const current = steps[currentStep]

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-bg-primary border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-bold text-text-primary">项目快速上手</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-bg-hover transition-colors"
            title="关闭"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex flex-col md:flex-row gap-6">
            {/* 左侧：步骤内容 */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4">
                {current.icon}
                <h3 className="text-lg font-semibold text-text-primary">{current.title}</h3>
              </div>
              <p className="text-text-secondary mb-6">{current.description}</p>
              <div className="space-y-2 mb-6">
                {current.tips.map((tip, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-accent-green mt-1 flex-shrink-0" />
                    <span className="text-text-secondary">{tip}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 右侧：图片 */}
            <div className="w-full md:w-1/2">
              <div className="rounded-lg overflow-hidden border border-border shadow-lg">
                <img
                  src={current.image}
                  alt={current.title}
                  className="w-full h-auto object-cover"
                />
              </div>
            </div>
          </div>

          {/* 步骤指示器 */}
          <div className="flex items-center justify-center gap-2 mt-8">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`w-3 h-3 rounded-full transition-all duration-300 ${index === currentStep ? 'bg-accent-blue w-8' : 'bg-bg-hover'}`}
              />
            ))}
          </div>
        </div>

        {/* 底部：导航按钮 */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <button
            onClick={prevStep}
            disabled={currentStep === 0}
            className="px-4 py-2 rounded-lg border border-border text-text-secondary hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            上一步
          </button>
          <div className="text-sm text-text-muted">
            {currentStep + 1} / {steps.length}
          </div>
          <button
            onClick={nextStep}
            className="px-4 py-2 rounded-lg bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors flex items-center gap-2"
          >
            {currentStep === steps.length - 1 ? '开始使用' : '下一步'}
            {currentStep < steps.length - 1 && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}

QuickStartGuide.displayName = 'QuickStartGuide'
export default QuickStartGuide