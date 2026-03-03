// ============================================
// Workflow Types
// ============================================

// Workflow step configuration (for reference in templates)
export interface WorkflowStep {
  id: string;
  order: number;
  name: string;
  description?: string;
  prompt_injection?: string;
  mcps_enabled?: string[];
  tools_blocked?: string[];
  gate_type?: 'any' | 'tool' | 'phrase' | 'always';
  gate_tool?: string;
  gate_phrases?: string[];
}

// Workflow settings
export interface WorkflowSettings {
  reset_policy: 'manual' | 'timeout' | 'per_session';
  timeout_minutes: number;
  force_sequential: boolean;
}

// Template for reusable workflow configurations
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  steps: WorkflowStep[];
  settings: WorkflowSettings;
}

// Per-project workflow configuration stored in agentcockpit-project.json
// Note: 'enabled' now comes from .claude/workflow/config.json (enforcer_enabled)
// Note: 'activeWorkflowId' now comes from .claude/workflow/state.json (active_workflow)
export interface ProjectWorkflowConfig {
  installedAt: number | null;
}
