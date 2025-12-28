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
}

// Actions for context reducer
export type AppAction =
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'REMOVE_PROJECT'; payload: string }
  | { type: 'SET_ACTIVE_PROJECT'; payload: string | null }
  | { type: 'ADD_TERMINAL'; payload: { projectId: string; terminal: Terminal } }
  | { type: 'REMOVE_TERMINAL'; payload: { projectId: string; terminalId: string } }
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
  | { type: 'SET_TERMINAL_OPACITY'; payload: number };
