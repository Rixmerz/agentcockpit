import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput } from "../services/tauriService";

/**
 * Hook to initialize and manage xterm Terminal with PTY backend
 * Provides full interactive terminal support (tmux, vim, etc.)
 */
export function useTerminal(containerRef: React.RefObject<HTMLDivElement>) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize terminal
    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
      fontSize: 14,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        cursorAccent: "#1e1e1e",
        selectionBackground: "#264f78",
      },
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    // Open terminal in container
    terminal.open(containerRef.current);

    // Store references
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Cleanup function holder
    let unlistenPty: (() => void) | null = null;

    // Initialize PTY
    const initPty = async () => {
      // Fit terminal first to get correct dimensions
      fitAddon.fit();

      const cols = terminal.cols;
      const rows = terminal.rows;

      try {
        // Listen for PTY output
        unlistenPty = await onPtyOutput((data) => {
          // Decode and write to terminal
          const decoder = new TextDecoder();
          terminal.write(decoder.decode(data));
        });

        // Spawn PTY with current dimensions
        await ptySpawn(cols, rows);
      } catch (error) {
        console.error("Failed to initialize PTY:", error);
        terminal.writeln("\x1b[31mFailed to initialize terminal\x1b[0m");
      }
    };

    // Wait for renderer then init PTY
    requestAnimationFrame(() => {
      initPty();
    });

    // Forward all input to PTY
    terminal.onData((data) => {
      ptyWrite(data).catch((err) => {
        console.error("PTY write error:", err);
      });
    });

    // Handle window resize
    const handleResize = () => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();
          const cols = terminalRef.current.cols;
          const rows = terminalRef.current.rows;
          ptyResize(cols, rows).catch((err) => {
            console.error("PTY resize error:", err);
          });
        }
      });
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      if (unlistenPty) {
        unlistenPty();
      }
      ptyClose().catch(() => {});
      terminal.dispose();
    };
  }, [containerRef]);

  return {
    terminal: terminalRef.current,
    fitAddon: fitAddonRef.current,
  };
}
