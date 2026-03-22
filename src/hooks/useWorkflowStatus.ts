import { useState, useEffect, useCallback } from 'react';
import type { WorkflowStatus } from '../services/workflow/index';
import { workflowService, copyAllAssetsToProject } from '../services/workflowService';
import { getEnforcerEnabled } from '../services/workflow/index';
import {
  isWorkflowHooksInstalled,
  installWorkflowHooks,
  uninstallWorkflowHooks,
  syncWorkflowHooks,
} from '../services/hookService';

export interface WorkflowInfo {
  name: string;
  currentNode: string | null;
  isActive: boolean;
}

export interface UseWorkflowStatusResult {
  availableWorkflows: string[];
  activeWorkflow: WorkflowInfo | null;
  isWorkflowInstalled: boolean;
  isInstallingWorkflow: boolean;
  workflowEnabled: boolean;
  handleSelectWorkflow: (workflowName: string) => Promise<void>;
  handleResetWorkflow: () => Promise<void>;
  handleInstallWorkflow: () => Promise<void>;
  handleUninstallWorkflow: () => Promise<void>;
  handleToggleWorkflowEnabled: () => Promise<void>;
}

export function useWorkflowStatus(
  projectPath: string | null,
  onWorkflowChange?: (workflowName: string | null) => void,
  onStatusChange?: (status: WorkflowStatus | null) => void,
): UseWorkflowStatusResult {
  const [availableWorkflows, setAvailableWorkflows] = useState<string[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowInfo | null>(null);
  const [, setWorkflowLoading] = useState(false);
  const [isWorkflowInstalled, setIsWorkflowInstalled] = useState(false);
  const [isInstallingWorkflow, setIsInstallingWorkflow] = useState(false);
  const [workflowEnabled, setWorkflowEnabled] = useState(true);

  // Load workflows on project change
  useEffect(() => {
    if (!projectPath) {
      setAvailableWorkflows([]);
      setActiveWorkflow(null);
      setIsWorkflowInstalled(false);
      return;
    }

    setActiveWorkflow(null);

    const loadWorkflows = async () => {
      try {
        const workflows = await workflowService.listAvailableWorkflows(projectPath);
        setAvailableWorkflows(workflows);

        const status = await workflowService.getStatus(projectPath);
        onStatusChange?.(status);
        if (status) {
          setActiveWorkflow({
            name: status.graphName || 'Unknown',
            currentNode: status.currentNode,
            isActive: true,
          });
        }

        const installed = await isWorkflowHooksInstalled(projectPath);
        setIsWorkflowInstalled(installed);

        const enabled = await getEnforcerEnabled(projectPath);
        setWorkflowEnabled(enabled);
      } catch (err) {
        console.warn('[useWorkflowStatus] Failed to load workflows:', err);
      }
    };

    loadWorkflows();
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectWorkflow = useCallback(async (workflowName: string) => {
    if (!projectPath) return;

    setWorkflowLoading(true);
    try {
      await workflowService.activateWorkflow(projectPath, workflowName);
      const status = await workflowService.getStatus(projectPath);
      setActiveWorkflow({
        name: workflowName,
        currentNode: status?.currentNode || null,
        isActive: true,
      });
      onWorkflowChange?.(workflowName);
    } catch (err) {
      console.error('[useWorkflowStatus] Failed to activate workflow:', err);
    } finally {
      setWorkflowLoading(false);
    }
  }, [projectPath, onWorkflowChange]);

  const handleResetWorkflow = useCallback(async () => {
    if (!projectPath) return;

    try {
      await workflowService.resetWorkflow(projectPath);
      const status = await workflowService.getStatus(projectPath);
      setActiveWorkflow(prev => prev ? { ...prev, currentNode: status?.currentNode || null } : prev);
    } catch (err) {
      console.error('[useWorkflowStatus] Failed to reset workflow:', err);
    }
  }, [projectPath]);

  const handleInstallWorkflow = useCallback(async () => {
    if (!projectPath) return;

    setIsInstallingWorkflow(true);
    try {
      const result = await installWorkflowHooks(projectPath, []);
      if (result.success) {
        await copyAllAssetsToProject(projectPath);
        setIsWorkflowInstalled(true);
      } else {
        console.error('[useWorkflowStatus] Install failed:', result.error);
      }
    } catch (err) {
      console.error('[useWorkflowStatus] Failed to install workflow:', err);
    } finally {
      setIsInstallingWorkflow(false);
    }
  }, [projectPath]);

  const handleUninstallWorkflow = useCallback(async () => {
    if (!projectPath) return;

    setIsInstallingWorkflow(true);
    try {
      const result = await uninstallWorkflowHooks(projectPath);
      if (result.success) {
        setIsWorkflowInstalled(false);
      } else {
        console.error('[useWorkflowStatus] Uninstall failed:', result.error);
      }
    } catch (err) {
      console.error('[useWorkflowStatus] Failed to uninstall workflow:', err);
    } finally {
      setIsInstallingWorkflow(false);
    }
  }, [projectPath]);

  const handleToggleWorkflowEnabled = useCallback(async () => {
    if (!projectPath) return;
    const newEnabled = !workflowEnabled;
    setWorkflowEnabled(newEnabled); // optimistic
    try {
      if (isWorkflowInstalled) {
        await syncWorkflowHooks(projectPath, newEnabled, []);
      }
    } catch (e) {
      console.error('[useWorkflowStatus] Toggle error:', e);
      setWorkflowEnabled(!newEnabled); // rollback
    }
  }, [projectPath, workflowEnabled, isWorkflowInstalled]);

  return {
    availableWorkflows,
    activeWorkflow,
    isWorkflowInstalled,
    isInstallingWorkflow,
    workflowEnabled,
    handleSelectWorkflow,
    handleResetWorkflow,
    handleInstallWorkflow,
    handleUninstallWorkflow,
    handleToggleWorkflowEnabled,
  };
}
