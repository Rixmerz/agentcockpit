// Claude session from ~/.claude/session-env
export interface ClaudeSession {
  id: string;
  lastAccessed: number;
  workingDir?: string;
}

// Claude session status for streaming UI
export type ClaudeSessionStatus = 'idle' | 'connecting' | 'streaming' | 'waiting' | 'completed' | 'error';
