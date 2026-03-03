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
