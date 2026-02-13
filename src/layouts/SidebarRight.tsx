/**
 * Sidebar Right - Actions Panel Wrapper
 *
 * Wraps the ActionsPanel with the necessary props from context.
 */

import { useApp, useTerminalActions } from '../contexts/AppContext';
import { ActionsPanel } from '../components/sidebar-right/ActionsPanel';

interface SidebarRightProps {
  availableIDEs: string[];
  onModalStateChange: (isOpen: boolean) => void;
}

export function SidebarRight({ availableIDEs, onModalStateChange }: SidebarRightProps) {
  const { activeProject, activeTerminal } = useApp();
  const { writeToActiveTerminal, hasActiveTerminal } = useTerminalActions();

  return (
    <aside className="sidebar-right">
      <ActionsPanel
        projectPath={activeProject?.path || null}
        terminalId={activeTerminal?.id || null}
        hasActiveTerminal={hasActiveTerminal}
        onWriteToTerminal={writeToActiveTerminal}
        availableIDEs={availableIDEs}
        onModalStateChange={onModalStateChange}
      />
    </aside>
  );
}
