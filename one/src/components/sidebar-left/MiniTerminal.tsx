import { useState, useCallback, useRef, useEffect } from 'react';
import { executeCommand, resolvePath, pathExists } from '../../services/fileSystemService';

interface MiniTerminalProps {
  onDirectorySelect?: (path: string) => void;
  initialPath?: string;
}

interface OutputLine {
  type: 'command' | 'output' | 'error';
  content: string;
}

export function MiniTerminal({ onDirectorySelect, initialPath = '~' }: MiniTerminalProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve initial path
  useEffect(() => {
    const home = '/Users/juanpablodiaz';
    if (initialPath === '~') {
      setCurrentPath(home);
    }
  }, [initialPath]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const addOutput = useCallback((type: OutputLine['type'], content: string) => {
    setOutput(prev => [...prev.slice(-20), { type, content }]); // Keep last 20 lines
  }, []);

  const handleCommand = useCallback(async (cmd: string) => {
    const trimmedCmd = cmd.trim();
    if (!trimmedCmd) return;

    addOutput('command', `$ ${trimmedCmd}`);
    setIsExecuting(true);

    try {
      const parts = trimmedCmd.split(/\s+/);
      const command = parts[0];
      const args = parts.slice(1).join(' ');

      if (command === 'cd') {
        // Handle cd command
        const targetPath = args || '~';
        const resolvedPath = resolvePath(currentPath, targetPath);

        const exists = await pathExists(resolvedPath);
        if (exists) {
          setCurrentPath(resolvedPath);
          onDirectorySelect?.(resolvedPath);
        } else {
          addOutput('error', `cd: no such directory: ${targetPath}`);
        }
      } else if (command === 'pwd') {
        addOutput('output', currentPath);
      } else if (command === 'ls') {
        const result = await executeCommand(`ls -la ${args}`, currentPath);
        addOutput('output', result);
      } else if (command === 'mkdir') {
        if (args) {
          const result = await executeCommand(`mkdir -p ${args}`, currentPath);
          if (result) {
            addOutput('output', result);
          } else {
            addOutput('output', `Created: ${args}`);
          }
        } else {
          addOutput('error', 'mkdir: missing operand');
        }
      } else if (command === 'clear') {
        setOutput([]);
      } else if (command === 'select' || command === 'use') {
        // Select current directory as project path
        onDirectorySelect?.(currentPath);
        addOutput('output', `Selected: ${currentPath}`);
      } else {
        // Execute as shell command
        const result = await executeCommand(trimmedCmd, currentPath);
        if (result) {
          addOutput('output', result);
        }
      }
    } catch (error) {
      addOutput('error', String(error));
    } finally {
      setIsExecuting(false);
    }
  }, [currentPath, addOutput, onDirectorySelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isExecuting) {
      handleCommand(input);
      setInput('');
    }
  }, [input, isExecuting, handleCommand]);

  // Shorten path for display
  const displayPath = currentPath.replace('/Users/juanpablodiaz', '~');

  return (
    <div className="mini-terminal">
      <div className="mini-terminal-output" ref={outputRef}>
        {output.map((line, i) => (
          <div key={i} className={`output-line ${line.type}`}>
            {line.content}
          </div>
        ))}
      </div>
      <div className="mini-terminal-input">
        <span className="prompt">{displayPath}$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="cd, ls, pwd, mkdir..."
          disabled={isExecuting}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
