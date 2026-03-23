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

  // Auto git init
  useEffect(() => {
    if (!activeProject?.path) return;
    hasLocalGitRepo(activeProject.path).then(hasRepo => {
      if (!hasRepo) initRepository(activeProject.path).catch(console.warn);
    });
  }, [activeProject?.path]);

  // Git watcher lifecycle
  useEffect(() => {
    if (activeProject?.path) {
      gitWatcherService.start(activeProject.path);
    } else {
      gitWatcherService.stop();
    }
    return () => gitWatcherService.stop();
  }, [activeProject?.path]);

  // Native file watcher for real-time DCC feedback
  useEffect(() => {
    if (activeProject?.path) {
      fileWatcherService.start(activeProject.path);
    } else {
      fileWatcherService.stop();
    }
    return () => { fileWatcherService.stop(); };
  }, [activeProject?.path]);

  // Ollama auto-start for semantic embeddings
  useEffect(() => {
    ollamaService.start();
    return () => { ollamaService.stop(); };
  }, []);

  // DCC auto-reindex toggle
  useEffect(() => {
    if (activeProject?.path) {
      gitWatcherService.setAutoReindex(activeProject.path, dccAutoReindex);
    }
    return () => gitWatcherService.setAutoReindex('', false);
  }, [activeProject?.path, dccAutoReindex]);

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
