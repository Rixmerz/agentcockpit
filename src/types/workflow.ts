// ============================================
// Workflow Types
// ============================================

// Re-export WorkflowStep from canonical source to avoid duplication
import type { WorkflowStep } from '../services/workflow/workflowIOService';
export type { WorkflowStep };

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
