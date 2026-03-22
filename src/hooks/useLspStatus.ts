import { useState, useEffect, useCallback } from 'react';
import {
  getLspStatus,
  detectProjectLsps,
  installLsp,
  uninstallLsp,
  autoSetupLsps,
  type LspStatus,
  type LspDetection,
} from '../services/lspService';

export interface UseLspStatusResult {
  lspStatuses: LspStatus[];
  lspDetection: LspDetection | null;
  lspInstalling: string | null;
  loadLspInfo: () => Promise<void>;
  handleInstallLsp: (plugin: string) => Promise<void>;
  handleUninstallLsp: (plugin: string) => Promise<void>;
  handleInstallAllMissing: () => Promise<void>;
}

export function useLspStatus(projectPath: string | null): UseLspStatusResult {
  const [lspStatuses, setLspStatuses] = useState<LspStatus[]>([]);
  const [lspDetection, setLspDetection] = useState<LspDetection | null>(null);
  const [lspInstalling, setLspInstalling] = useState<string | null>(null);

  // Auto-setup LSPs on project change: detect → install → enable → refresh
  useEffect(() => {
    if (!projectPath) {
      setLspStatuses([]);
      setLspDetection(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Run auto-setup (installs missing binaries + registers + enables plugins)
        const result = await autoSetupLsps(projectPath);
        if (cancelled) return;
        if (result.actions.length > 0) {
          console.log('[useLspStatus] LSP auto-setup:', result.actions);
        }
        // Refresh statuses after setup
        const [statuses, detection] = await Promise.all([
          getLspStatus(),
          detectProjectLsps(projectPath),
        ]);
        if (cancelled) return;
        setLspStatuses(statuses);
        setLspDetection(detection);
      } catch (err) {
        if (cancelled) return;
        console.warn('[useLspStatus] LSP auto-setup failed:', err);
        // Fallback to just detection
        detectProjectLsps(projectPath).then(setLspDetection).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath]);

  // Load LSP info on-demand (when dropdown opens)
  const loadLspInfo = useCallback(async () => {
    try {
      const statuses = await getLspStatus();
      setLspStatuses(statuses);
      if (projectPath) {
        const detection = await detectProjectLsps(projectPath);
        setLspDetection(detection);
      }
    } catch (err) {
      console.warn('[useLspStatus] Failed to load LSP info:', err);
    }
  }, [projectPath]);

  // Handle LSP install
  const handleInstallLsp = useCallback(async (plugin: string) => {
    setLspInstalling(plugin);
    try {
      await installLsp(plugin);
      await loadLspInfo();
    } catch (err) {
      console.error('[useLspStatus] Failed to install LSP:', err);
    } finally {
      setLspInstalling(null);
    }
  }, [loadLspInfo]);

  // Handle LSP uninstall
  const handleUninstallLsp = useCallback(async (plugin: string) => {
    setLspInstalling(plugin);
    try {
      await uninstallLsp(plugin);
      await loadLspInfo();
    } catch (err) {
      console.error('[useLspStatus] Failed to uninstall LSP:', err);
    } finally {
      setLspInstalling(null);
    }
  }, [loadLspInfo]);

  // Handle install all missing LSPs — refresh UI after each one
  const handleInstallAllMissing = useCallback(async () => {
    if (!lspDetection?.missing.length) return;
    const toInstall = [...lspDetection.missing];
    for (const plugin of toInstall) {
      setLspInstalling(plugin);
      try {
        const ok = await installLsp(plugin);
        if (ok) {
          // Refresh statuses after each successful install so UI updates
          const statuses = await getLspStatus();
          setLspStatuses(statuses);
          if (projectPath) {
            const detection = await detectProjectLsps(projectPath);
            setLspDetection(detection);
          }
        }
      } catch (err) {
        console.error(`[useLspStatus] Failed to install ${plugin}:`, err);
      }
    }
    setLspInstalling(null);
  }, [lspDetection, projectPath]);

  return {
    lspStatuses,
    lspDetection,
    lspInstalling,
    loadLspInfo,
    handleInstallLsp,
    handleUninstallLsp,
    handleInstallAllMissing,
  };
}
