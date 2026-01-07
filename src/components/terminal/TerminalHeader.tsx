import { ExternalLink } from 'lucide-react';

interface TerminalHeaderProps {
  name: string;
  projectName?: string;
  onClose?: () => void;
  onOpenInIDE?: () => void;
  selectedIDE?: string | null;
}

export function TerminalHeader({
  name,
  projectName,
  onClose,
  onOpenInIDE,
  selectedIDE
}: TerminalHeaderProps) {
  return (
    <div className="terminal-header">
      <div className="terminal-info">
        {projectName && (
          <span className="project-badge">{projectName}</span>
        )}
        <span className="terminal-name">{name}</span>
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
