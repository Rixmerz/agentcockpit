import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { usePty } from '../../hooks/usePty';
import { useApp } from '../../contexts/AppContext';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  terminalId: string;
  workingDir: string;
  onClose?: () => void;
}

// Minimum interval between terminal flushes (ms)
// 32ms = ~30fps, good balance between smoothness and performance
const MIN_FLUSH_INTERVAL_MS = 32;

// Maximum pending buffer size before forcing a flush (prevents memory buildup)
const MAX_PENDING_SIZE = 8192;

export function TerminalView({ terminalId, workingDir, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  // Write batching refs for smoother rendering
  const pendingWritesRef = useRef<string>('');
  const pendingSizeRef = useRef<number>(0);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushTimeRef = useRef<number>(0);

  const { registerTerminalWriter, unregisterTerminalWriter, registerPtyId } = useApp();

  // Flush pending writes to terminal
  const flushWrites = useCallback(() => {
    flushTimeoutRef.current = null;

    if (pendingWritesRef.current && terminalRef.current) {
      const data = pendingWritesRef.current;
      pendingWritesRef.current = '';
      pendingSizeRef.current = 0;
      lastFlushTimeRef.current = performance.now();

      // Write to terminal
      terminalRef.current.write(data);
    }
  }, []);

  // Schedule a write with throttling for smooth rendering
  const scheduleWrite = useCallback((data: string) => {
    // Append to pending buffer
    pendingWritesRef.current += data;
    pendingSizeRef.current += data.length;

    // Force immediate flush if buffer is too large
    if (pendingSizeRef.current >= MAX_PENDING_SIZE) {
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      flushWrites();
      return;
    }

    // Already scheduled? Let it run
    if (flushTimeoutRef.current) {
      return;
    }

    // Calculate delay based on time since last flush
    const now = performance.now();
    const timeSinceLastFlush = now - lastFlushTimeRef.current;
    const delay = Math.max(0, MIN_FLUSH_INTERVAL_MS - timeSinceLastFlush);

    // Schedule flush
    flushTimeoutRef.current = setTimeout(flushWrites, delay);
  }, [flushWrites]);

  // PTY hook with callbacks
  const { spawn, write, resize } = usePty({
    onData: useCallback((data: string) => {
      scheduleWrite(data);
    }, [scheduleWrite]),
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
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      allowTransparency: true,
      scrollback: 10000,
      // Options for better ANSI sequence handling and reduced jumping
      scrollOnUserInput: false,      // Don't auto-scroll on input (reduces jumping)
      scrollOnEraseInDisplay: true,  // Critical for Claude Code spinner
      drawBoldTextInBrightColors: true,
      rescaleOverlappingGlyphs: true,
      smoothScrollDuration: 0,       // Disable smooth scroll (instant updates)
      windowOptions: {
        getWinSizePixels: true,
        getCellSizePixels: true,
        getWinSizeChars: true,
      },
      theme: {
        background: 'transparent',
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
      allowProposedApi: true,
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';  // Enable Unicode 11 for emojis

    // Open terminal in container
    terminal.open(containerRef.current);

    // Note: Using DOM renderer (default) instead of CanvasAddon
    // CanvasAddon causes glyph corruption with rapid updates (spinners, counters)
    // DOM renderer is slower but more stable for ANSI sequences and Unicode

    // Initial fit with delay to ensure container has final dimensions
    fitAddon.fit();
    setTimeout(() => fitAddon.fit(), 100);
    setTimeout(() => fitAddon.fit(), 300);

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
      // Clean up pending flush timeout
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      // Flush any remaining data before cleanup
      if (pendingWritesRef.current && terminalRef.current) {
        terminalRef.current.write(pendingWritesRef.current);
        pendingWritesRef.current = '';
      }
    };
  }, [terminalId, workingDir, spawn, write, resize, registerPtyId]);

  // Handle window resize
  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      // Debounce resize to prevent excessive calls
      if (resizeTimeout) clearTimeout(resizeTimeout);

      resizeTimeout = setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();
          // Also notify PTY of new dimensions
          const { cols, rows } = terminalRef.current;
          resize(cols, rows).catch(console.error);
        }
      }, 50);
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
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [resize]);

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
