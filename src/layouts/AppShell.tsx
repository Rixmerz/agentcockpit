/**
 * App Shell - Main Layout
 *
 * Composes SidebarLeft, MainContent, and SidebarRight.
 * Manages app-level concerns: theme, background, idle mode, keyboard shortcuts.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApp, useAppSettings } from '../contexts/AppContext';
import { hasLocalGitRepo, initRepository } from '../services/gitService';
import { gitWatcherService } from '../services/gitWatcherService';
import { fileWatcherService } from '../services/fileWatcherService';
import { ollamaService } from '../services/ollamaService';
import { scanProject } from '../services/securityScanService';

import { useIdleMode } from '../hooks/useIdleMode';
import { useBackgroundImage } from '../hooks/useBackgroundImage';
import { useIDEDetection } from '../hooks/useIDEDetection';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { SidebarLeft } from './SidebarLeft';
import { MainContentArea } from './MainContent';
import { SidebarRight } from './SidebarRight';
import { LoadingScreen } from '../components/common/LoadingScreen';

export function AppShell() {
  const { state, activeProject, activeTerminal, addTerminal, removeTerminal } = useApp();
  const { defaultIDE, theme, backgroundImage, backgroundOpacity, idleTimeout, dccAutoReindex } = useAppSettings();

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Immediate: git init + git watcher (lightweight, needed for UI)
  useEffect(() => {
    if (!activeProject?.path) {
      gitWatcherService.stop();
      return;
    }
    hasLocalGitRepo(activeProject.path).then(hasRepo => {
      if (!hasRepo) initRepository(activeProject.path).catch(console.warn);
    });
    gitWatcherService.start(activeProject.path);
    return () => gitWatcherService.stop();
  }, [activeProject?.path]);

  // Deferred: heavy services (after UI paint)
  useEffect(() => {
    if (!activeProject?.path) return;
    const path = activeProject.path;
    let cancelled = false;
    const defer = typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback
      : (fn: () => void) => setTimeout(fn, 100);

    defer(() => { if (!cancelled) fileWatcherService.start(path).catch(console.warn); });
    defer(() => { if (!cancelled) scanProject(path).catch(console.warn); });
    defer(() => { if (!cancelled) gitWatcherService.setAutoReindex(path, dccAutoReindex); });

    return () => {
      cancelled = true;
      fileWatcherService.stop();
      gitWatcherService.setAutoReindex('', false);
    };
  }, [activeProject?.path, dccAutoReindex]);

  // Ollama: lazy init after paint
  useEffect(() => {
    const id = typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback(() => { ollamaService.start(); })
      : setTimeout(() => { ollamaService.start(); }, 3000);
    return () => {
      if (typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(id as number);
      else clearTimeout(id as ReturnType<typeof setTimeout>);
      ollamaService.stop();
    };
  }, []);

  // Idle mode
  const { isIdle, signalActivity } = useIdleMode({
    idleTimeout: idleTimeout > 0 ? idleTimeout * 1000 : 0
  });

  // Background image
  const { getBackgroundUrl } = useBackgroundImage();

  // IDE detection
  const { availableIDEs, selectedIDE, handleOpenInIDE } = useIDEDetection(defaultIDE);

  // Track modal state for ActionsPanel (value consumed only by the callback)
  const [, setActionsPanelModalOpen] = useState(false);

  const handleAddTerminal = useCallback((projectId: string) => {
    const project = state.projects.find(p => p.id === projectId);
    if (project) {
      const terminalName = `Terminal ${project.terminals.length + 1}`;
      addTerminal(projectId, terminalName);
    }
  }, [state.projects, addTerminal]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    activeProjectId: activeProject?.id,
    activeTerminalId: activeTerminal?.id,
    activeProjectPath: activeProject?.path,
    selectedIDE,
    onNewTerminal: useCallback(() => {
      if (activeProject) handleAddTerminal(activeProject.id);
    }, [activeProject, handleAddTerminal]),
    onCloseTerminal: useCallback(() => {
      if (activeProject && activeTerminal) removeTerminal(activeProject.id, activeTerminal.id);
    }, [activeProject, activeTerminal, removeTerminal]),
    onOpenInIDE: handleOpenInIDE,
  });

  if (state.isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div
      className={`app ${isIdle ? 'app--idle' : ''}`}
      data-theme={theme}
      style={{
        backgroundImage: getBackgroundUrl(backgroundImage),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {backgroundImage && (
        <div
          className="app-background-overlay"
          style={{ opacity: isIdle ? 0 : 1 - backgroundOpacity / 100 }}
        />
      )}

      <SidebarLeft onAddTerminal={handleAddTerminal} />

      <MainContentArea
        selectedIDE={selectedIDE}
        handleOpenInIDE={handleOpenInIDE}
        signalActivity={signalActivity}
      />

      <SidebarRight
        availableIDEs={availableIDEs}
        onModalStateChange={setActionsPanelModalOpen}
      />
    </div>
  );
}
