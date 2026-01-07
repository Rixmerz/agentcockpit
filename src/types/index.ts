// Terminal instance within a project
export interface Terminal {
  id: string;
  name: string;
  claudeSessionId?: string; // Associated Claude CLI session UUID
  createdAt: number;
}

// Project = directory in filesystem
export interface Project {
  id: string;
  name: string;
  path: string; // Absolute path to directory
  terminals: Terminal[];
  createdAt: number;
}

// App configuration persisted to JSON
export interface AppConfig {
  projects: Project[];
  activeProjectId: string | null;
  activeTerminalId: string | null;
  selectedModel: 'haiku' | 'sonnet' | 'opus';
  mcpDesktopEnabled: boolean;
  mcpDefaultEnabled: boolean;
  // Global settings
  defaultIDE?: 'cursor' | 'code' | 'antigravity';
  backgroundImage?: string;  // URL or local path
  backgroundOpacity?: number; // 0-100
  terminalOpacity?: number; // 0-100, opacity of terminal container
  idleTimeout?: number; // Seconds before idle mode (0 = disabled)
  // Terminal notification settings
  terminalFinishedSound?: boolean; // Play sound when terminal finishes
  terminalFinishedThreshold?: number; // Seconds of inactivity before "finished" (1-10)
  customSoundPath?: string | null; // Custom notification sound file path
}

// Terminal activity state for tracking "finished" status
export interface TerminalActivityState {
  terminalId: string;
  lastOutputAt: number;
  isFinished: boolean;
}

// PTY instance managed by Rust backend
export interface PtyInstance {
  id: number;
  terminalId: string;
  cols: number;
  rows: number;
}

// Claude session from ~/.claude/session-env
export interface ClaudeSession {
  id: string;
  lastAccessed: number;
  workingDir?: string;
}

// App context state
export interface AppState extends AppConfig {
  ptyInstances: Map<string, PtyInstance>;
  isLoading: boolean;
  // Runtime state (not persisted)
  terminalActivity: Map<string, TerminalActivityState>;
}

// Actions for context reducer
export type AppAction =
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'REMOVE_PROJECT'; payload: string }
  | { type: 'SET_ACTIVE_PROJECT'; payload: string | null }
  | { type: 'ADD_TERMINAL'; payload: { projectId: string; terminal: Terminal } }
  | { type: 'REMOVE_TERMINAL'; payload: { projectId: string; terminalId: string } }
  | { type: 'RENAME_TERMINAL'; payload: { projectId: string; terminalId: string; name: string } }
  | { type: 'SET_ACTIVE_TERMINAL'; payload: string | null }
  | { type: 'SET_MODEL'; payload: 'haiku' | 'sonnet' | 'opus' }
  | { type: 'TOGGLE_MCP_DESKTOP' }
  | { type: 'TOGGLE_MCP_DEFAULT' }
  | { type: 'SET_PTY_INSTANCE'; payload: PtyInstance }
  | { type: 'REMOVE_PTY_INSTANCE'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'LOAD_CONFIG'; payload: AppConfig }
  // Global settings actions
  | { type: 'SET_DEFAULT_IDE'; payload: 'cursor' | 'code' | 'antigravity' | undefined }
  | { type: 'SET_BACKGROUND_IMAGE'; payload: string | undefined }
  | { type: 'SET_BACKGROUND_OPACITY'; payload: number }
  | { type: 'SET_TERMINAL_OPACITY'; payload: number }
  | { type: 'SET_IDLE_TIMEOUT'; payload: number }
  // Terminal notification settings actions
  | { type: 'SET_TERMINAL_FINISHED_SOUND'; payload: boolean }
  | { type: 'SET_TERMINAL_FINISHED_THRESHOLD'; payload: number }
  | { type: 'SET_CUSTOM_SOUND_PATH'; payload: string | null }
  // Terminal activity tracking
  | { type: 'SET_TERMINAL_ACTIVITY'; payload: { terminalId: string; isFinished: boolean; lastOutputAt: number } }
  | { type: 'CLEAR_TERMINAL_ACTIVITY'; payload: string };
