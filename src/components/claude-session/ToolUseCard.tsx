import { useState } from 'react';
import { ChevronRight, Wrench, Check, X, Loader2, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import type { ToolUseContentBlock } from '../../types/claude-events';

type ToolStatus = 'running' | 'success' | 'error';

interface ToolUseCardProps {
  toolUse: ToolUseContentBlock;
  result?: string;
  status: ToolStatus;
}

const COLLAPSED_LINES = 10;

function truncate(value: unknown, maxLen = 300): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\u2026';
}

/**
 * Render file diff for Edit tool: shows old_string → new_string with red/green styling.
 */
function renderEditDiff(input: Record<string, unknown>): React.ReactNode {
  const filePath = input.file_path as string | undefined;
  const oldStr = input.old_string as string | undefined;
  const newStr = input.new_string as string | undefined;

  if (!oldStr && !newStr) return null;

  return (
    <div className="tool-diff">
      {filePath && <div className="tool-diff__file">{filePath}</div>}
      {oldStr && (
        <div className="tool-diff__removed">
          {oldStr.split('\n').map((line, i) => (
            <div key={`r-${i}`} className="tool-diff__line tool-diff__line--removed">
              <span className="tool-diff__gutter">-</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
      {newStr && (
        <div className="tool-diff__added">
          {newStr.split('\n').map((line, i) => (
            <div key={`a-${i}`} className="tool-diff__line tool-diff__line--added">
              <span className="tool-diff__gutter">+</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Render file content for Read tool results with line numbers.
 */
function renderFileContent(content: string): React.ReactNode {
  const lines = content.split('\n');
  return (
    <div className="tool-file-content">
      {lines.map((line, i) => (
        <div key={i} className="tool-file-content__line">
          <span className="tool-file-content__line-num">{i + 1}</span>
          <span className="tool-file-content__line-text">{line}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Render terminal-style output for Bash tool results.
 */
function renderBashOutput(content: string, input: Record<string, unknown>): React.ReactNode {
  const command = input.command as string | undefined;
  return (
    <div className="tool-terminal">
      {command && (
        <div className="tool-terminal__command">
          <span className="tool-terminal__prompt">$</span> {command}
        </div>
      )}
      <div className="tool-terminal__output">{content}</div>
    </div>
  );
}

/**
 * Collapsible content wrapper: shows first N lines, then "Show more" toggle.
 */
function CollapsibleContent({ content, children }: { content: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = content.split('\n').length;

  if (lineCount <= COLLAPSED_LINES) {
    return <>{children}</>;
  }

  if (expanded) {
    return (
      <div>
        {children}
        <button className="tool-card__toggle" onClick={() => setExpanded(false)}>
          <ChevronDown className="tool-card__toggle-icon tool-card__toggle-icon--up" />
          Show less
        </button>
      </div>
    );
  }

  // Render only first N lines
  const truncatedContent = content.split('\n').slice(0, COLLAPSED_LINES).join('\n');
  const remaining = lineCount - COLLAPSED_LINES;

  return (
    <div>
      <div className="tool-card__content">{truncatedContent}</div>
      <button className="tool-card__toggle" onClick={() => setExpanded(true)}>
        <ChevronDown className="tool-card__toggle-icon" />
        Show {remaining} more lines
      </button>
    </div>
  );
}

/**
 * Render the tool result with structured formatting based on tool name.
 */
function renderStructuredResult(toolName: string, input: Record<string, unknown>, result: string): React.ReactNode {
  const name = toolName.toLowerCase();

  // Edit tool: show diff
  if (name === 'edit' || name.endsWith('_edit') || name.includes('edit')) {
    const diff = renderEditDiff(input);
    if (diff) return diff;
  }

  // Write tool: show file path context
  if (name === 'write' || name.endsWith('_write') || name.includes('write')) {
    const filePath = input.file_path as string | undefined;
    if (filePath) {
      return (
        <div>
          <div className="tool-diff__file">{filePath}</div>
          <CollapsibleContent content={result}>
            {renderFileContent(result)}
          </CollapsibleContent>
        </div>
      );
    }
  }

  // Read tool: show file content with line numbers
  if (name === 'read' || name.endsWith('_read') || name.includes('read')) {
    return (
      <CollapsibleContent content={result}>
        {renderFileContent(result)}
      </CollapsibleContent>
    );
  }

  // Bash tool: terminal-style output
  if (name === 'bash' || name.endsWith('_bash') || name.includes('bash')) {
    return (
      <CollapsibleContent content={result}>
        {renderBashOutput(result, input)}
      </CollapsibleContent>
    );
  }

  // Default: plain text with collapsible
  return (
    <CollapsibleContent content={result}>
      <div className="tool-card__content">{result}</div>
    </CollapsibleContent>
  );
}

export function ToolUseCard({ toolUse, result, status }: ToolUseCardProps) {
  // Default: expanded for running, collapsed for completed
  const [isOpen, setIsOpen] = useState(status === 'running');

  const StatusIcon = status === 'running' ? Loader2
    : status === 'success' ? Check
    : X;

  // Format input display: for Edit show file path, for Bash show command
  const inputSummary = (() => {
    const name = toolUse.name.toLowerCase();
    if ((name === 'edit' || name.includes('edit')) && toolUse.input.file_path) {
      return truncate(toolUse.input.file_path, 80);
    }
    if ((name === 'bash' || name.includes('bash')) && toolUse.input.command) {
      return truncate(toolUse.input.command, 80);
    }
    if ((name === 'read' || name.includes('read')) && toolUse.input.file_path) {
      return truncate(toolUse.input.file_path, 80);
    }
    if ((name === 'write' || name.includes('write')) && toolUse.input.file_path) {
      return truncate(toolUse.input.file_path, 80);
    }
    return null;
  })();

  return (
    <div className={clsx('tool-card', `tool-card--${status}`)}>
      <div
        className="tool-card__header"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <ChevronRight
          className={clsx('tool-card__chevron', isOpen && 'tool-card__chevron--open')}
        />
        <Wrench className={clsx('tool-card__icon', `tool-card__icon--${status}`)} />
        <span className="tool-card__name">{toolUse.name}</span>
        {inputSummary && (
          <span className="tool-card__summary">{inputSummary}</span>
        )}
        <StatusIcon className={clsx('tool-card__icon', `tool-card__icon--${status}`)} />
      </div>

      {isOpen && (
        <div className="tool-card__body">
          <div className="tool-card__section-label">Input</div>
          <div className="tool-card__content">
            {truncate(toolUse.input)}
          </div>

          {result != null && (
            <>
              <div className="tool-card__divider" />
              <div className="tool-card__section-label">Result</div>
              {renderStructuredResult(toolUse.name, toolUse.input, result)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
