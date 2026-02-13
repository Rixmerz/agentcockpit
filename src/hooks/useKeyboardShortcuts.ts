import { useEffect } from 'react';

interface UseKeyboardShortcutsOptions {
  activeProjectId: string | undefined;
  activeTerminalId: string | undefined;
  activeProjectPath: string | undefined;
  selectedIDE: string | null;
  onNewTerminal: () => void;
  onCloseTerminal: () => void;
  onOpenInIDE: (path: string) => void;
}

export function useKeyboardShortcuts({
  activeProjectId,
  activeTerminalId,
  activeProjectPath,
  selectedIDE,
  onNewTerminal,
  onCloseTerminal,
  onOpenInIDE,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + N: New terminal in active project
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        if (activeProjectId) {
          onNewTerminal();
        }
      }
      // Cmd/Ctrl + W: Close active terminal
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeProjectId && activeTerminalId) {
          onCloseTerminal();
        }
      }
      // Cmd/Ctrl + O: Open in IDE
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        if (activeProjectPath && selectedIDE) {
          onOpenInIDE(activeProjectPath);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeProjectId, activeTerminalId, activeProjectPath, selectedIDE, onNewTerminal, onCloseTerminal, onOpenInIDE]);
}
