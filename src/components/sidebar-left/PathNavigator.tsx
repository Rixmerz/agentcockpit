import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openFolderDialog } from '../../services/fileSystemService';
import { FolderOpen } from 'lucide-react';

interface PathNavigatorProps {
  onCreateProject: (name: string, path: string) => void;
}

interface OutputLine {
  type: 'command' | 'output' | 'error';
  content: string;
}

const HOME = '/Users/juanpablodiaz';

// Check if path exists using shell (more reliable than fs plugin)
async function checkPathExists(path: string): Promise<boolean> {
  try {
    await invoke<string>('execute_command', {
      cmd: `test -d "${path}" && echo "yes"`,
      cwd: '/',
    });
    return true;
  } catch {
    return false;
  }
}

export function PathNavigator({ onCreateProject }: PathNavigatorProps) {
  const [currentPath, setCurrentPath] = useState(HOME);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const addOutput = useCallback((type: OutputLine['type'], content: string) => {
    setOutput(prev => [...prev.slice(-30), { type, content }]);
  }, []);

  // Resolve path helper
  const resolvePath = useCallback((basePath: string, newPath: string): string => {
    if (newPath.startsWith('~')) {
      newPath = newPath.replace('~', HOME);
    }
    if (newPath.startsWith('/')) {
      return newPath;
    }

    const parts = basePath.split('/').filter(Boolean);
    for (const part of newPath.split('/')) {
      if (part === '..') {
        parts.pop();
      } else if (part !== '.' && part !== '') {
        parts.push(part);
      }
    }
    return '/' + parts.join('/');
  }, []);

  // Execute command
  const executeCommand = useCallback(async (cmd: string) => {
    const trimmedCmd = cmd.trim();
    if (!trimmedCmd) return;

    // Add to history
    setHistory(prev => [...prev.filter(h => h !== trimmedCmd), trimmedCmd].slice(-50));
    setHistoryIndex(-1);

    addOutput('command', `$ ${trimmedCmd}`);
    setIsExecuting(true);

    try {
      const parts = trimmedCmd.split(/\s+/);
      const command = parts[0];
      const args = parts.slice(1).join(' ');

      switch (command) {
        case 'cd': {
          const targetPath = args || '~';
          const resolvedPath = resolvePath(currentPath, targetPath);
          const exists = await checkPathExists(resolvedPath);
          if (exists) {
            setCurrentPath(resolvedPath);
            addOutput('output', resolvedPath.replace(HOME, '~'));
          } else {
            addOutput('error', `cd: no existe: ${targetPath}`);
          }
          break;
        }

        case 'pwd':
          addOutput('output', currentPath);
          break;

        case 'ls': {
          const result = await invoke<string>('execute_command', {
            cmd: `ls -1F ${args}`.trim(),
            cwd: currentPath,
          });
          if (result.trim()) {
            addOutput('output', result.trim());
          } else {
            addOutput('output', '(vacío)');
          }
          break;
        }

        case 'mkdir': {
          if (!args) {
            addOutput('error', 'mkdir: falta nombre');
            break;
          }
          await invoke<string>('execute_command', {
            cmd: `mkdir -p "${args}"`,
            cwd: currentPath,
          });
          addOutput('output', `Creado: ${args}`);
          break;
        }

        case 'clear':
          setOutput([]);
          break;

        case 'help':
          addOutput('output', 'Comandos: cd, ls, pwd, mkdir, clear, help');
          break;

        default: {
          // Try to execute as shell command
          try {
            const result = await invoke<string>('execute_command', {
              cmd: trimmedCmd,
              cwd: currentPath,
            });
            if (result.trim()) {
              addOutput('output', result.trim());
            }
          } catch (err) {
            addOutput('error', String(err));
          }
        }
      }
    } catch (error) {
      addOutput('error', String(error));
    } finally {
      setIsExecuting(false);
    }
  }, [currentPath, addOutput, resolvePath]);

  // Tab completion
  const handleTabCompletion = useCallback(async () => {
    // Parse input to find what we're completing
    const parts = input.split(/\s+/);
    const lastPart = parts[parts.length - 1] || '';

    // Determine the directory to search and the prefix to match
    let searchDir = currentPath;
    let prefix = lastPart;

    if (lastPart.includes('/')) {
      const lastSlash = lastPart.lastIndexOf('/');
      const dirPart = lastPart.slice(0, lastSlash) || '/';
      prefix = lastPart.slice(lastSlash + 1);
      searchDir = resolvePath(currentPath, dirPart);
    }

    try {
      // Get directory listing with -F to show / for directories
      const result = await invoke<string>('execute_command', {
        cmd: 'ls -1F',
        cwd: searchDir,
      });

      const entries = result.split('\n').filter(e => e.trim());

      // Find matches (compare without trailing symbols)
      const matches = entries.filter(e => {
        const name = e.replace(/[*@|=\/]$/, '');
        return name.toLowerCase().startsWith(prefix.toLowerCase());
      });

      if (matches.length === 1) {
        // Single match - complete it (keep the / if it's a directory)
        const completion = matches[0].replace(/[*@|=]$/, ''); // Keep / for dirs
        const beforeLastPart = parts.slice(0, -1).join(' ');
        const lastPartDir = lastPart.includes('/')
          ? lastPart.slice(0, lastPart.lastIndexOf('/') + 1)
          : '';

        const newInput = beforeLastPart
          ? `${beforeLastPart} ${lastPartDir}${completion}`
          : `${lastPartDir}${completion}`;

        setInput(newInput);
      } else if (matches.length > 1) {
        // Multiple matches - show them
        addOutput('output', matches.join('  '));

        // Find common prefix (without trailing symbols)
        const cleanMatches = matches.map(m => m.replace(/[*@|=\/]$/, ''));
        let commonPrefix = cleanMatches[0];
        for (const match of cleanMatches) {
          while (commonPrefix && !match.toLowerCase().startsWith(commonPrefix.toLowerCase())) {
            commonPrefix = commonPrefix.slice(0, -1);
          }
        }

        if (commonPrefix && commonPrefix.length > prefix.length) {
          const beforeLastPart = parts.slice(0, -1).join(' ');
          const lastPartDir = lastPart.includes('/')
            ? lastPart.slice(0, lastPart.lastIndexOf('/') + 1)
            : '';

          const newInput = beforeLastPart
            ? `${beforeLastPart} ${lastPartDir}${commonPrefix}`
            : `${lastPartDir}${commonPrefix}`;

          setInput(newInput);
        }
      }
    } catch {
      // Ignore errors during completion
    }
  }, [input, currentPath, resolvePath, addOutput]);

  // Handle keyboard
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isExecuting) {
      executeCommand(input);
      setInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleTabCompletion();
    }
  }, [input, isExecuting, executeCommand, history, historyIndex, handleTabCompletion]);

  // Open folder dialog
  const handleOpenDialog = useCallback(async () => {
    const path = await openFolderDialog();
    if (path) {
      setCurrentPath(path);
      addOutput('output', `Navegado a: ${path.replace(HOME, '~')}`);
    }
  }, [addOutput]);

  // Create project
  const handleCreateProject = useCallback(() => {
    const folderName = currentPath.split('/').pop() || 'proyecto';
    onCreateProject(folderName, currentPath);
    addOutput('output', `Proyecto creado: ${folderName}`);
  }, [currentPath, onCreateProject, addOutput]);

  const displayPath = currentPath.replace(HOME, '~');

  return (
    <div className="path-navigator">
      {/* Quick actions */}
      <div className="path-nav-actions">
        <button
          className="path-nav-btn"
          onClick={handleOpenDialog}
          title="Buscar carpeta..."
        >
          <FolderOpen size={14} />
        </button>
        <div className="path-nav-current" title={currentPath}>
          {displayPath}
        </div>
      </div>

      {/* Terminal output */}
      <div className="path-nav-output" ref={outputRef}>
        {output.map((line, i) => (
          <div key={i} className={`output-line ${line.type}`}>
            {line.content}
          </div>
        ))}
      </div>

      {/* Command input */}
      <div className="path-nav-input">
        <span className="prompt">$</span>
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

      {/* Create project button */}
      <button className="btn-create-project" onClick={handleCreateProject}>
        <div className="flex items-center justify-center gap-2">
          <span>Crear Proyecto {displayPath.split('/').pop() || '~'}</span>
        </div>
      </button>
    </div>
  );
}
