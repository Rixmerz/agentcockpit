import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  panelName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.panelName}] Error:`, error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '12px', color: '#ef4444', fontSize: '12px', textAlign: 'center' }}>
          <p>{this.props.panelName} crashed</p>
          <button
            onClick={this.handleRetry}
            style={{ marginTop: '8px', padding: '4px 12px', cursor: 'pointer', background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: '4px' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
