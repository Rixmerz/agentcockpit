import React, { useRef } from "react";
import { useTerminal } from "../hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";
import styles from "./Terminal.module.css";

/**
 * Terminal Component
 * Displays an xterm terminal emulator integrated with Tauri backend
 */
export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { terminal } = useTerminal(containerRef);

  const handleInput = (data: string) => {
    // Will integrate with Tauri backend to execute commands
    if (terminal) {
      terminal.write(`You typed: ${data}\r\n`);
    }
  };

  return (
    <div className={styles.terminalWrapper}>
      <div className={styles.terminalHeader}>
        <span className={styles.title}>one-term</span>
        <div className={styles.controls}>
          <button className={styles.btnMin}>−</button>
          <button className={styles.btnMax}>□</button>
          <button className={styles.btnClose}>✕</button>
        </div>
      </div>
      <div ref={containerRef} className={styles.terminalContainer} />
    </div>
  );
}

export default Terminal;
