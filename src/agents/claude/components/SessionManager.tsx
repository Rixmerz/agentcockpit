import { useState, useEffect, useCallback } from 'react';
import {
  getSessions,
  deleteSession,
  type ProjectSession,
} from '../../../services/projectSessionService';

interface SessionManagerProps {
  projectPath: string | null;
  selectedSession: ProjectSession | null;
  onSessionSelect: (session: ProjectSession | null) => void;
}

export function SessionManager({
  projectPath,
  selectedSession,
  onSessionSelect,
}: SessionManagerProps) {
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!projectPath) {
      setSessions([]);
      return;
    }

    setIsLoading(true);
    try {
      const loaded = await getSessions(projectPath);
      setSessions(loaded);
    } catch (e) {
      console.error('Failed to load sessions:', e);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Detect sessions created externally (from resume UUID detection)
  useEffect(() => {
    if (selectedSession && projectPath) {
      const sessionExists = sessions.some(s => s.id === selectedSession.id);
      if (!sessionExists) {
        setSessions(prev => [selectedSession, ...prev]);
      }
    }
  }, [selectedSession, projectPath, sessions]);

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!projectPath) return;

    try {
      await deleteSession(projectPath, sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (selectedSession?.id === sessionId) {
        onSessionSelect(null);
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatSessionId = (id: string) => {
    return id.slice(0, 8);
  };

  if (!projectPath) {
    return (
      <div className="session-manager disabled">
        <div className="session-header">
          <span>Sessions</span>
        </div>
        <div className="session-empty">Select a project</div>
      </div>
    );
  }

  return (
    <div className="session-manager">
      <div
        className="session-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="session-title">
          Sessions ({sessions.length})
        </span>
        <span className="session-expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="session-list">
          {isLoading ? (
            <div className="session-loading">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="session-empty">
              No previous sessions
              <span className="text-xs opacity-60">Start Claude to create one</span>
            </div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                className={`session-item ${selectedSession?.id === session.id ? 'selected' : ''}`}
                onClick={() => onSessionSelect(session)}
              >
                <div className="session-item-main">
                  <span className="session-name">{session.name}</span>
                  <span className="session-id" title={session.id}>
                    {formatSessionId(session.id)}
                  </span>
                </div>
                <div className="session-item-meta">
                  <span className="session-date">{formatDate(session.lastUsed)}</span>
                  <button
                    className="session-delete-btn"
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
