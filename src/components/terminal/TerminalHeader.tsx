interface TerminalHeaderProps {
  name: string;
  projectName?: string;
  onClose?: () => void;
}

export function TerminalHeader({ name, projectName, onClose }: TerminalHeaderProps) {
  return (
    <div className="terminal-header">
      <div className="terminal-info">
        {projectName && (
          <span className="project-badge">{projectName}</span>
        )}
        <span className="terminal-name">{name}</span>
      </div>

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
