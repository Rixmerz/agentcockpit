import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: '16px',
          padding: '24px',
          background: 'var(--bg-primary, #18181b)',
          color: 'var(--text-primary, #e4e4e7)',
        }}>
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            padding: '20px 24px',
            maxWidth: '480px',
            width: '100%',
          }}>
            <div style={{ fontWeight: 600, fontSize: '14px', color: '#ef4444', marginBottom: '8px' }}>
              Something went wrong
            </div>
            <div style={{ fontSize: '12px', opacity: 0.8, fontFamily: 'monospace', wordBreak: 'break-word' }}>
              {this.state.error?.message ?? 'Unknown error'}
            </div>
          </div>
          <button
            onClick={this.handleReload}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              background: 'var(--color-accent-primary, #00d4aa)',
              color: '#000',
              fontWeight: 600,
              fontSize: '13px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
