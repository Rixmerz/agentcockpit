import type { Project } from './project';

// Available themes
export type ThemeId = 'cyber-teal' | 'battlefield';

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
  theme?: ThemeId; // Color theme
  backgroundImage?: string;  // URL or local path
  backgroundOpacity?: number; // 0-100
  terminalOpacity?: number; // 0-100, opacity of terminal container
  idleTimeout?: number; // Seconds before idle mode (0 = disabled)
  // Terminal notification settings
  terminalFinishedSound?: boolean; // Play sound when terminal finishes
  terminalFinishedThreshold?: number; // Seconds of inactivity before "finished" (1-10)
  customSoundPath?: string | null; // Custom notification sound file path
  // DCC settings
  dccAutoReindex?: boolean; // Auto-reindex on commits (default: false)
}
