/**
 * App Shell - Main Layout
 *
 * Composes SidebarLeft, MainContent, and SidebarRight.
 * Manages app-level concerns: theme, background, idle mode, keyboard shortcuts.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApp, useAppSettings } from '../contexts/AppContext';
import { hasLocalGitRepo, initRepository } from '../services/gitService';
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
  const { defaultIDE, theme, backgroundImage, backgroundOpacity, idleTimeout } = useAppSettings();

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Auto git init when switching to a project without .git
  useEffect(() => {
    if (!activeProject?.path) return;
    hasLocalGitRepo(activeProject.path).then(hasRepo => {
      if (!hasRepo) initRepository(activeProject.path).catch(console.warn);
    });
  }, [activeProject?.path]);

  // Idle mode
  const { isIdle, signalActivity } = useIdleMode({
    idleTimeout: idleTimeout > 0 ? idleTimeout * 1000 : 0
  });

  // Background image
  const { getBackgroundUrl } = useBackgroundImage();

  // IDE detection
  const { availableIDEs, selectedIDE, handleOpenInIDE } = useIDEDetection(defaultIDE);

  // Modal tracking (for browser webview z-index)
  const [actionsPanelModalOpen, setActionsPanelModalOpen] = useState(false);

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
        isIdle={isIdle}
        signalActivity={signalActivity}
        anyModalOpen={actionsPanelModalOpen}
      />

      <SidebarRight
        availableIDEs={availableIDEs}
        onModalStateChange={setActionsPanelModalOpen}
      />
    </div>
  );
}
