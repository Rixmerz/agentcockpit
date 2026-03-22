interface ErrorBannerProps {
  message: string;
  onClose: () => void;
}

export function ErrorBanner({ message, onClose }: ErrorBannerProps) {
  return (
    <div className="session-error error-banner">
      <div className="error-banner__body">
        <span className="error-banner__icon">!</span>
        <div className="error-banner__content">
          <div className="error-banner__title">Error</div>
          <div className="error-banner__message">{message}</div>
          <button
            className="error-banner__close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
