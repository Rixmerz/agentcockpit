interface ErrorBannerProps {
  message: string;
  onClose: () => void;
}

export function ErrorBanner({ message, onClose }: ErrorBannerProps) {
  return (
    <div className="session-error" style={{
      padding: '12px',
      margin: '8px',
      borderRadius: '6px',
      backgroundColor: 'rgba(239, 68, 68, 0.15)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      color: '#ef4444'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <span style={{ fontSize: '14px' }}>!</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px' }}>Error</div>
          <div style={{ fontSize: '11px', opacity: 0.9 }}>{message}</div>
          <button
            style={{
              fontSize: '11px',
              textDecoration: 'underline',
              marginTop: '8px',
              opacity: 0.7,
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: 0
            }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
