import { ExternalLink, Globe } from 'lucide-react';
import { MediaControlBar } from './MediaControlBar';

interface TerminalHeaderProps {
  name: string;
  projectName?: string;
  onClose?: () => void;
  onOpenInIDE?: () => void;
  selectedIDE?: string | null;
  onBrowserToggle?: () => void;
  isBrowserOpen?: boolean;
  showMediaControls?: boolean;
  onMediaTabFocus?: (tabId: string) => void;
}

export function TerminalHeader({
  name,
  projectName,
  onClose,
  onOpenInIDE,
  selectedIDE,
  onBrowserToggle,
  isBrowserOpen,
  showMediaControls = true,
  onMediaTabFocus
}: TerminalHeaderProps) {
  return (
    <div className="terminal-header">
      <div className="terminal-info">
        {projectName && (
          <span className="project-badge">{projectName}</span>
        )}
        <span className="terminal-name">{name}</span>
      </div>

      <div className="terminal-header-center">
        {showMediaControls && (
          <MediaControlBar onTabFocus={onMediaTabFocus} />
        )}
      </div>

      <div className="terminal-header-actions">
        {/* Open in IDE Button */}
        {onOpenInIDE && selectedIDE && (
          <button
            className="btn-ide-open"
            onClick={onOpenInIDE}
            title={`Open in ${selectedIDE} (⌘+O)`}
          >
            <ExternalLink size={14} />
            <span>{selectedIDE}</span>
          </button>
        )}

        {/* Browser Toggle Button */}
        {onBrowserToggle && (
          <button
            className={`btn-browser-toggle ${isBrowserOpen ? 'active' : ''}`}
            onClick={onBrowserToggle}
            title={isBrowserOpen ? 'Close browser' : 'Open browser'}
          >
            <Globe size={14} />
          </button>
        )}

        {onClose && (
          <button
            className="btn-close"
            onClick={onClose}
            title="Close terminal"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}
