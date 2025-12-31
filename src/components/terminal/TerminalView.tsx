import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { usePty } from '../../hooks/usePty';
import { useApp } from '../../contexts/AppContext';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  terminalId: string;
  workingDir: string;
  onClose?: () => void;
}

// BRUTAL SIMPLE IMPLEMENTATION - No extras, no configs, just basics
export function TerminalView({ terminalId, workingDir, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const initializedRef = useRef(false);

  const { registerTerminalWriter, unregisterTerminalWriter, registerPtyId } = useApp();

  // PTY hook - direct writes, no processing
  const { spawn, write, resize } = usePty({
    onData: (data: string) => {
      terminalRef.current?.write(data);
    },
    onClose: () => {
      terminalRef.current?.write('\r\n[Process exited]\r\n');
      onClose?.();
    },
  });

  // Register writer
  useEffect(() => {
    registerTerminalWriter(terminalId, write);
    return () => unregisterTerminalWriter(terminalId);
  }, [terminalId, write, registerTerminalWriter, unregisterTerminalWriter]);

  // Initialize terminal - MINIMAL
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Bare minimum terminal
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e4e4e7',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
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
        terminal.write(`Error: ${err}\r\n`);
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
      style={{
        width: '100%',
        height: '100%',
        background: '#1a1a1a',
      }}
    />
  );
}
