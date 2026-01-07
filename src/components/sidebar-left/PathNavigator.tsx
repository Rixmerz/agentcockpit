import { useState, useCallback, useRef, useEffect } from 'react';
import { exists, readDir, mkdir } from '@tauri-apps/plugin-fs';
import { openFolderDialog } from '../../services/fileSystemService';
import { FolderOpen } from 'lucide-react';
import { withTimeout } from '../../core/utils/promiseTimeout';

interface PathNavigatorProps {
  onCreateProject: (name: string, path: string) => void;
}

interface OutputLine {
  type: 'command' | 'output' | 'error';
  content: string;
}

const HOME = '/Users/juanpablodiaz';
const FS_TIMEOUT_MS = 3000;

// Check if path exists using Tauri FS plugin (avoids TCC cascade)
async function checkPathExists(path: string): Promise<boolean> {
  try {
    return await withTimeout(exists(path), FS_TIMEOUT_MS, 'check path exists');
  } catch {
    return false;
  }
}

// List directory contents using Tauri FS plugin
async function listDirectory(path: string): Promise<{ name: string; isDir: boolean }[]> {
  try {
    const entries = await withTimeout(readDir(path), FS_TIMEOUT_MS, 'list directory');
    return entries.map(entry => ({
      name: entry.name,
      isDir: entry.isDirectory,
    }));
  } catch {
    return [];
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
            addOutput('error', `cd: does not exist: ${targetPath}`);
          }
          break;
        }

        case 'pwd':
          addOutput('output', currentPath);
          break;

        case 'ls': {
          const targetPath = args ? resolvePath(currentPath, args) : currentPath;
          const entries = await listDirectory(targetPath);
          if (entries.length > 0) {
            // Format like ls -1F: directories have trailing /
            const formatted = entries
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(e => e.isDir ? `${e.name}/` : e.name)
              .join('\n');
            addOutput('output', formatted);
          } else {
            addOutput('output', '(empty)');
          }
          break;
        }

        case 'mkdir': {
          if (!args) {
            addOutput('error', 'mkdir: missing name');
            break;
          }
          const newDirPath = resolvePath(currentPath, args);
          try {
            await withTimeout(
              mkdir(newDirPath, { recursive: true }),
              FS_TIMEOUT_MS,
              'create directory'
            );
            addOutput('output', `Created: ${args}`);
          } catch (err) {
            addOutput('error', `mkdir: ${String(err)}`);
          }
          break;
        }

        case 'clear':
          setOutput([]);
          break;

        case 'help':
          addOutput('output', 'Comandos: cd, ls, pwd, mkdir, clear, help');
          break;

        default: {
          // Only support safe file navigation commands
          addOutput('error', `Unsupported command: ${command}`);
          addOutput('output', 'Use: cd, ls, pwd, mkdir, clear, help');
        }
      }
    } catch (error) {
      addOutput('error', String(error));
    } finally {
      setIsExecuting(false);
    }
  }, [currentPath, addOutput, resolvePath]);

  // Tab completion using Tauri FS (avoids TCC cascade)
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
      // Get directory listing using Tauri FS
      const entries = await listDirectory(searchDir);

      // Format entries like ls -1F (directories have trailing /)
      const formattedEntries = entries.map(e => e.isDir ? `${e.name}/` : e.name);

      // Find matches (compare without trailing /)
      const matches = formattedEntries.filter(e => {
        const name = e.replace(/\/$/, '');
        return name.toLowerCase().startsWith(prefix.toLowerCase());
      });

      if (matches.length === 1) {
        // Single match - complete it (keep the / if it's a directory)
        const completion = matches[0];
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

        // Find common prefix (without trailing /)
        const cleanMatches = matches.map(m => m.replace(/\/$/, ''));
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
      addOutput('output', `Navigated to: ${path.replace(HOME, '~')}`);
    }
  }, [addOutput]);

  // Create project
  const handleCreateProject = useCallback(() => {
    const folderName = currentPath.split('/').pop() || 'proyecto';
    onCreateProject(folderName, currentPath);
    addOutput('output', `Project created: ${folderName}`);
  }, [currentPath, onCreateProject, addOutput]);

  const displayPath = currentPath.replace(HOME, '~');

  return (
    <div className="path-navigator">
      {/* Quick actions */}
      <div className="path-nav-actions">
        <button
          className="path-nav-btn"
          onClick={handleOpenDialog}
          title="Browse folder..."
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
          <span>Create Project {displayPath.split('/').pop() || '~'}</span>
        </div>
      </button>
    </div>
  );
}
