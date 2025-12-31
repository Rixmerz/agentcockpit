import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { open } from '@tauri-apps/plugin-shell';
import { usePty } from '../../hooks/usePty';
import { useApp } from '../../contexts/AppContext';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  terminalId: string;
  workingDir: string;
  onClose?: () => void;
}

// Minimum interval between terminal flushes (ms)
// 50ms = ~20fps, gives more time for complete ANSI sequences to arrive
const MIN_FLUSH_INTERVAL_MS = 50;

// Maximum pending buffer size before forcing a flush (prevents memory buildup)
const MAX_PENDING_SIZE = 8192;

// Maximum time to hold incomplete sequences before forcing flush (prevents hangs)
const MAX_INCOMPLETE_HOLD_MS = 200;

/**
 * Detects if there's an incomplete ANSI escape sequence at the end of the string.
 * This prevents TUI corruption when sequences are split across flushes.
 *
 * ANSI sequences:
 * - CSI: \x1b[ ... <letter> (e.g., \x1b[38;5;240m)
 * - OSC: \x1b] ... \x07 or \x1b\\ (e.g., \x1b]0;title\x07)
 * - Simple: \x1b<letter> (e.g., \x1bM)
 */
function hasIncompleteAnsiSequence(str: string): boolean {
  if (!str) return false;

  // Find the last ESC character
  const lastEscIndex = str.lastIndexOf('\x1b');
  if (lastEscIndex === -1) return false;

  // Get everything after the last ESC
  const afterEsc = str.slice(lastEscIndex);

  // Just ESC alone - incomplete
  if (afterEsc === '\x1b') return true;

  // CSI sequence: \x1b[ ... must end with a letter (A-Za-z)
  if (afterEsc.startsWith('\x1b[')) {
    // CSI parameters can include digits, semicolons, question marks, etc.
    // The sequence ends when we hit a letter
    const afterBracket = afterEsc.slice(2);
    // Check if there's a terminating letter
    if (!/[A-Za-z]/.test(afterBracket)) {
      return true; // No terminating letter found - incomplete
    }
    // Check if the letter is at the end (complete) or if there's more after it
    const match = afterBracket.match(/[A-Za-z]/);
    if (match && match.index !== undefined) {
      // If the letter is at the end of afterBracket, sequence is complete
      // If there's content after it, that content might have another incomplete sequence
      return false;
    }
  }

  // OSC sequence: \x1b] ... must end with \x07 (BEL) or \x1b\\ (ST)
  if (afterEsc.startsWith('\x1b]')) {
    if (!afterEsc.includes('\x07') && !afterEsc.includes('\x1b\\')) {
      return true; // No terminator found - incomplete
    }
  }

  // Simple escape: \x1b followed by single letter (like \x1bM for reverse index)
  // These are always 2 chars, so if we have \x1b + letter, it's complete
  if (afterEsc.length === 2 && /[A-Za-z]/.test(afterEsc[1])) {
    return false; // Complete simple escape
  }

  return false;
}

export function TerminalView({ terminalId, workingDir, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const initializedRef = useRef(false);

  // Search UI state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Write batching refs for smoother rendering
  const pendingWritesRef = useRef<string>('');
  const pendingSizeRef = useRef<number>(0);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushTimeRef = useRef<number>(0);
  const incompleteHoldStartRef = useRef<number>(0); // Track when we started holding incomplete data

  const { registerTerminalWriter, unregisterTerminalWriter, registerPtyId } = useApp();

  // Flush pending writes to terminal
  // Handles incomplete ANSI sequences by retaining them for the next flush
  const flushWrites = useCallback(() => {
    flushTimeoutRef.current = null;

    if (pendingWritesRef.current && terminalRef.current) {
      const data = pendingWritesRef.current;
      const now = performance.now();

      // Check for incomplete ANSI sequence at the end
      if (hasIncompleteAnsiSequence(data)) {
        const lastEscIndex = data.lastIndexOf('\x1b');

        // Check if we've been holding this incomplete sequence too long
        const holdingTooLong = incompleteHoldStartRef.current > 0 &&
          (now - incompleteHoldStartRef.current) > MAX_INCOMPLETE_HOLD_MS;

        if (holdingTooLong) {
          // Force flush everything - sequence is probably malformed
          console.warn('[Terminal] Forcing flush of incomplete ANSI sequence after timeout');
          pendingWritesRef.current = '';
          pendingSizeRef.current = 0;
          incompleteHoldStartRef.current = 0;
          lastFlushTimeRef.current = now;
          terminalRef.current.write(data);
        } else {
          // Retain incomplete part, flush complete part
          if (incompleteHoldStartRef.current === 0) {
            incompleteHoldStartRef.current = now; // Start tracking hold time
          }

          const completeData = data.slice(0, lastEscIndex);
          const incompleteData = data.slice(lastEscIndex);

          if (completeData) {
            terminalRef.current.write(completeData);
          }

          // Keep the incomplete part for next flush
          pendingWritesRef.current = incompleteData;
          pendingSizeRef.current = incompleteData.length;
          lastFlushTimeRef.current = now;

          // Schedule another flush to handle the incomplete data
          flushTimeoutRef.current = setTimeout(() => {
            flushTimeoutRef.current = null;
            // This will re-check if the sequence is now complete
            if (pendingWritesRef.current && terminalRef.current) {
              const remaining = pendingWritesRef.current;
              pendingWritesRef.current = '';
              pendingSizeRef.current = 0;
              incompleteHoldStartRef.current = 0;
              terminalRef.current.write(remaining);
            }
          }, MIN_FLUSH_INTERVAL_MS);
        }
      } else {
        // No incomplete sequences - flush normally
        pendingWritesRef.current = '';
        pendingSizeRef.current = 0;
        incompleteHoldStartRef.current = 0;
        lastFlushTimeRef.current = now;
        terminalRef.current.write(data);
      }
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
    const unicode11Addon = new Unicode11Addon();
    const clipboardAddon = new ClipboardAddon();
    const ligaturesAddon = new LigaturesAddon();
    const searchAddon = new SearchAddon();

    // WebLinksAddon with custom handler to open URLs in browser
    // Supports: Click, Shift+Click, Cmd/Ctrl+Click
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      // Open URL in default browser using Tauri shell
      open(uri).catch((err) => {
        console.error('[Terminal] Failed to open URL:', uri, err);
      });
    }, {
      // URL validation options
      urlRegex: /https?:\/\/[^\s"'<>]+/g,
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(clipboardAddon);
    terminal.loadAddon(ligaturesAddon);
    terminal.loadAddon(searchAddon);
    terminal.unicode.activeVersion = '11';  // Enable Unicode 11 for emojis
    searchAddonRef.current = searchAddon;

    // Open terminal in container
    terminal.open(containerRef.current);

    // Load WebGL renderer for GPU-accelerated performance (like VS Code, Hyper, iTerm2)
    // Falls back to DOM renderer if WebGL is not supported or context is lost
    try {
      const webglAddon = new WebglAddon();

      // Handle WebGL context loss (GPU crash, system suspend, etc.)
      webglAddon.onContextLoss(() => {
        console.warn('[Terminal] WebGL context lost, falling back to DOM renderer');
        webglAddon.dispose();
      });

      terminal.loadAddon(webglAddon);
      console.log('[Terminal] WebGL renderer enabled');
    } catch (e) {
      console.log('[Terminal] WebGL not supported, using DOM renderer:', e);
    }

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

  // Keyboard shortcut for search (Cmd+F / Ctrl+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
      // Escape to close search
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchQuery('');
        searchAddonRef.current?.clearDecorations();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch]);

  // Search handlers
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchAddonRef.current) {
      if (value) {
        searchAddonRef.current.findNext(value, { caseSensitive: false, regex: false });
      } else {
        searchAddonRef.current.clearDecorations();
      }
    }
  }, []);

  const handleSearchNext = useCallback(() => {
    if (searchAddonRef.current && searchQuery) {
      searchAddonRef.current.findNext(searchQuery, { caseSensitive: false, regex: false });
    }
  }, [searchQuery]);

  const handleSearchPrev = useCallback(() => {
    if (searchAddonRef.current && searchQuery) {
      searchAddonRef.current.findPrevious(searchQuery, { caseSensitive: false, regex: false });
    }
  }, [searchQuery]);

  const handleCloseSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery('');
    searchAddonRef.current?.clearDecorations();
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Search bar */}
      {showSearch && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: '#2d2d2d',
            border: '1px solid #444',
            borderRadius: 4,
            padding: '4px 8px',
          }}
        >
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? handleSearchPrev() : handleSearchNext();
              }
            }}
            placeholder="Search..."
            autoFocus
            style={{
              background: '#1a1a1a',
              border: '1px solid #555',
              borderRadius: 2,
              padding: '4px 8px',
              color: '#e4e4e7',
              fontSize: 12,
              width: 180,
              outline: 'none',
            }}
          />
          <button
            onClick={handleSearchPrev}
            title="Previous (Shift+Enter)"
            style={{
              background: '#444',
              border: 'none',
              borderRadius: 2,
              padding: '4px 8px',
              color: '#e4e4e7',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            ↑
          </button>
          <button
            onClick={handleSearchNext}
            title="Next (Enter)"
            style={{
              background: '#444',
              border: 'none',
              borderRadius: 2,
              padding: '4px 8px',
              color: '#e4e4e7',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            ↓
          </button>
          <button
            onClick={handleCloseSearch}
            title="Close (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '4px 8px',
              color: '#888',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ×
          </button>
        </div>
      )}
      {/* Terminal container */}
      <div
        ref={containerRef}
        className="terminal-xterm"
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}
