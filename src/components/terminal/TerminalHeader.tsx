import { SnapshotSelector } from './SnapshotSelector';

interface TerminalHeaderProps {
  name: string;
  projectName?: string;
  projectPath?: string;
  onClose?: () => void;
}

export function TerminalHeader({ name, projectName, projectPath, onClose }: TerminalHeaderProps) {
  return (
    <div className="terminal-header">
      <div className="terminal-info">
        {projectName && (
          <span className="project-badge">{projectName}</span>
        )}
        <span className="terminal-name">{name}</span>
      </div>

      {/* Snapshot Selector - only show if projectPath is available */}
      {projectPath && (
        <SnapshotSelector projectPath={projectPath} />
      )}

      {onClose && (
        <button
          className="btn-close"
          onClick={onClose}
          title="Cerrar terminal"
        >
          &times;
        </button>
      )}
    </div>
  );
}
