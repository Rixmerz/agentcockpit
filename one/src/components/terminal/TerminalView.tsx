import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { usePty } from '../../hooks/usePty';
import { useApp } from '../../contexts/AppContext';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  terminalId: string;
  workingDir: string;
  onClose?: () => void;
}

export function TerminalView({ terminalId, workingDir, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  const { registerTerminalWriter, unregisterTerminalWriter, registerPtyId } = useApp();

  // PTY hook with callbacks
  const { spawn, write, resize } = usePty({
    onData: useCallback((data: string) => {
      terminalRef.current?.write(data);
    }, []),
    onClose: useCallback(() => {
      terminalRef.current?.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
      onClose?.();
    }, [onClose]),
  });

  // Register writer with context
  useEffect(() => {
    registerTerminalWriter(terminalId, write);
    return () => {
      unregisterTerminalWriter(terminalId);
    };
  }, [terminalId, write, registerTerminalWriter, unregisterTerminalWriter]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Create terminal instance
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
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
      allowProposedApi: true,
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    // Open terminal in container
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Get dimensions and spawn PTY
    const { cols, rows } = terminal;
    // Default to zsh on macOS/Linux - TODO: detect platform via Tauri
    const shell = '/bin/zsh';

    spawn(shell, workingDir, cols, rows)
      .then((ptyId) => {
        console.log(`PTY ${ptyId} spawned for terminal ${terminalId}`);
        // Register PTY ID so it can be closed when terminal is removed
        registerPtyId(terminalId, ptyId);
      })
      .catch((err) => {
        console.error('Failed to spawn PTY:', err);
        terminal.write(`\x1b[31mError: ${err}\x1b[0m\r\n`);
      });

    // Handle terminal input
    terminal.onData((data) => {
      write(data).catch(console.error);
    });

    // Handle resize
    terminal.onResize(({ cols, rows }) => {
      resize(cols, rows).catch(console.error);
    });

    // Cleanup - Do NOT dispose terminal, it persists across tab switches
    // Terminal is only destroyed when removed from project
    return () => {
      // Keep terminal alive - no cleanup needed
    };
  }, [terminalId, workingDir, spawn, write, resize, registerPtyId]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);

    // Also observe container size changes
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e1e',
      }}
    />
  );
}
