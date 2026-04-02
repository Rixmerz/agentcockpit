import { useEffect, useRef, useCallback, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { open } from '@tauri-apps/plugin-shell';
import { usePty } from '../../hooks/usePty';
import { useTerminalActivity } from '../../hooks/useTerminalActivity';
import { useAppSettings, useTerminalActivityState } from '../../contexts/AppContext';
import { playNotificationSound } from '../../services/soundService';
import { sessionEvents } from '../../core/utils/eventBus';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  terminalId: string;
  workingDir: string;
  onClose?: () => void;
  /** Called on user input to signal activity (resets idle timer) */
  onActivity?: () => void;
  /** Pass from parent to avoid context subscription inside memo */
  registerTerminalWriter: (id: string, writer: (data: string) => Promise<void>) => void;
  unregisterTerminalWriter: (id: string) => void;
  registerPtyId: (terminalId: string, ptyId: number) => void;
}

export const TerminalView = memo(function TerminalView({ terminalId, workingDir, onClose, onActivity, registerTerminalWriter, unregisterTerminalWriter, registerPtyId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const initializedRef = useRef(false);

  // Terminal notification settings
  const {
    terminalFinishedSound,
    terminalFinishedThreshold,
    customSoundPath,
  } = useAppSettings();

  // Terminal activity state
  const { setTerminalActivity, clearTerminalActivity } = useTerminalActivityState();

  // Callback when terminal finishes (no output for threshold duration)
  const handleTerminalFinished = useCallback(() => {
    setTerminalActivity(terminalId, true, Date.now());
    if (terminalFinishedSound) {
      playNotificationSound(customSoundPath);
    }
  }, [terminalId, terminalFinishedSound, customSoundPath, setTerminalActivity]);

  // Terminal activity tracking hook
  const { signalOutput, signalUserInput } = useTerminalActivity({
    terminalId,
    threshold: terminalFinishedThreshold * 1000,
    onFinished: handleTerminalFinished,
    enabled: true,
  });

  // Cleanup activity state on unmount
  useEffect(() => {
    return () => {
      clearTerminalActivity(terminalId);
    };
  }, [terminalId, clearTerminalActivity]);

  // Debounced terminal activity sync to global state
  // Avoids dispatching SET_TERMINAL_ACTIVITY on every PTY output chunk,
  // which would re-render ALL AppContext consumers (ControlBar, IndexPanel, etc.)
  const activitySyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncActivityToGlobal = useCallback((isFinished: boolean) => {
    if (activitySyncRef.current) clearTimeout(activitySyncRef.current);
    activitySyncRef.current = setTimeout(() => {
      setTerminalActivity(terminalId, isFinished, Date.now());
      activitySyncRef.current = null;
    }, 500);
  }, [terminalId, setTerminalActivity]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (activitySyncRef.current) clearTimeout(activitySyncRef.current);
    };
  }, []);

  // Buffer for detecting resume UUID in PTY output
  const resumeBufferRef = useRef<string>('');

  // PTY hook - direct writes
  const { spawn, write, resize } = usePty({
    onData: (data: string) => {
      terminalRef.current?.write(data);
      // Signal ALL output - the hook handles filtering based on user input timing
      // This works because signalUserInput() is called when user types,
      // and signalOutput() ignores output that occurs within the grace period
      signalOutput();
      // Debounced sync to global state (at most once per 500ms)
      syncActivityToGlobal(false);

      // Detect resume UUID in output
      const stripped = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      resumeBufferRef.current += stripped;
      if (resumeBufferRef.current.length > 300) {
        resumeBufferRef.current = resumeBufferRef.current.slice(-300);
      }
      const match = resumeBufferRef.current.match(
        /claude\s+--resume\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
      );
      if (match) {
        sessionEvents.emit('resume-detected', { uuid: match[1], terminalId });
        resumeBufferRef.current = '';
      }
    },
    onClose: () => {
      terminalRef.current?.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
      onClose?.();
    },
  });

  // Register writer
  useEffect(() => {
    registerTerminalWriter(terminalId, write);
    return () => unregisterTerminalWriter(terminalId);
  }, [terminalId, write, registerTerminalWriter, unregisterTerminalWriter]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrainsMono Nerd Font', 'JetBrainsMono NF', 'CaskaydiaMono Nerd Font', 'Menlo', monospace",
      allowTransparency: true,
      scrollback: 10000,
      theme: {
        background: 'rgba(0, 0, 0, 0)',
        foreground: '#e4e4e7',
        cursor: '#ffffff',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
    });

    // Addons
    const fitAddon = new FitAddon();
    const clipboardAddon = new ClipboardAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      open(uri).catch((err) => console.error('[Terminal] Failed to open URL:', uri, err));
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(clipboardAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    terminalRef.current = terminal;

    // Fit and spawn
    fitAddon.fit();
    const { cols, rows } = terminal;

    spawn('default', workingDir, cols, rows)
      .then((ptyId) => {
        registerPtyId(terminalId, ptyId);
      })
      .catch((err) => {
        terminal.write(`\x1b[31mError: ${err}\x1b[0m\r\n`);
      });

    // Input
    terminal.onData((data) => {
      write(data).catch(console.error);
      // Signal user input - prevents shell echo from triggering notification
      signalUserInput();
      // Signal activity to reset idle timer
      onActivity?.();
    });

    // Resize — guard against 0x0 dimensions (happens when container gets display:none)
    terminal.onResize(({ cols, rows }) => {
      if (cols > 0 && rows > 0) {
        resize(cols, rows).catch(console.error);
      }
    });

    // Cleanup: dispose xterm and addons (stops FitAddon ResizeObserver)
    return () => {
      fitAddon.dispose();
      clipboardAddon.dispose();
      webLinksAddon.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [terminalId, workingDir, spawn, write, resize, registerPtyId, signalUserInput]);

  return (
    <div
      ref={containerRef}
      className="terminal-xterm"
      style={{
        width: '100%',
        height: '100%',
      }}
    />
  );
});
