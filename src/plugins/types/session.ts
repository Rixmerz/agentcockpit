/**
 * Session information (agent-agnostic)
 */
export interface SessionInfo {
  /** Unique session ID */
  id: string;

  /** Display name */
  name: string;

  /** Creation timestamp */
  createdAt: number;

  /** Last used timestamp */
  lastUsed: number;

  /** Model used in this session */
  model?: string;

  /** Associated terminal ID */
  terminalId?: string;

  /** Whether session existed before current app session */
  wasPreExisting?: boolean;
}
