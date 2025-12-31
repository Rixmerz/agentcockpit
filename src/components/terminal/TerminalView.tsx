import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { open } from '@tauri-apps/plugin-shell';
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
  const initializedRef = useRef(false);

  const { registerTerminalWriter, unregisterTerminalWriter, registerPtyId } = useApp();

  // PTY hook - direct writes
  const { spawn, write, resize } = usePty({
    onData: (data: string) => {
      terminalRef.current?.write(data);
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
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
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

    spawn('/bin/zsh', workingDir, cols, rows)
      .then((ptyId) => {
        console.log(`PTY ${ptyId} spawned at ${cols}x${rows}`);
        registerPtyId(terminalId, ptyId);
      })
      .catch((err) => {
        terminal.write(`\x1b[31mError: ${err}\x1b[0m\r\n`);
      });

    // Input
    terminal.onData((data) => {
      write(data).catch(console.error);
    });

    // Resize
    terminal.onResize(({ cols, rows }) => {
      resize(cols, rows).catch(console.error);
    });

    return () => {};
  }, [terminalId, workingDir, spawn, write, resize, registerPtyId]);

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
}
