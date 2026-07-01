import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: '#0f0f0f', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif', gap: 16,
        }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Something went wrong</h2>
          <pre style={{ fontSize: 12, color: '#f87171', maxWidth: 600, textAlign: 'center' }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', background: '#4ade80', color: '#0f0f0f',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
