import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, errorInfo: ErrorInfo) => ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.state.errorInfo!)
      }

      return (
        <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
          <div className="max-w-2xl p-8 bg-gray-800 rounded-lg shadow-xl">
            <h1 className="text-2xl font-bold text-red-400 mb-4">应用程序错误</h1>
            <p className="text-gray-300 mb-4">抱歉，应用程序遇到了一个错误。</p>
            <details className="mb-4">
              <summary className="cursor-pointer text-blue-400 hover:text-blue-300">
                查看错误详情
              </summary>
              <pre className="mt-2 p-4 bg-gray-900 rounded text-sm overflow-auto max-h-96">
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              重新加载应用
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
