import { Bot } from 'lucide-react';
import type { TextContentBlock } from '../../types/claude-events';
import { CodeBlock } from './CodeBlock';

interface MessageBubbleProps {
  blocks: TextContentBlock[];
}

/**
 * Lightweight markdown renderer — regex-based, covers the common 80%.
 * Handles: headers, bold, italic, inline code, code blocks, lists, links, blockquotes.
 */
function renderMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];

  // Split on code blocks first (``` ... ```)
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const segments: { type: 'text' | 'code'; content: string; language?: string }[] = [];

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', content: match[2], language: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  let keyCounter = 0;

  for (const segment of segments) {
    if (segment.type === 'code') {
      elements.push(
        <CodeBlock key={`cb-${keyCounter++}`} code={segment.content.replace(/\n$/, '')} language={segment.language} />
      );
    } else {
      const inlineElements = renderInlineMarkdown(segment.content, keyCounter);
      elements.push(...inlineElements);
      keyCounter += inlineElements.length;
    }
  }

  return elements;
}

/**
 * Render inline markdown: lines with headers, lists, blockquotes, bold/italic/code/links.
 */
function renderInlineMarkdown(text: string, startKey: number): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let key = startKey;

  // Split into lines for block-level parsing
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Headers: # ## ###
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = renderInlineFormatting(headerMatch[2], key++);
      if (level === 1) {
        elements.push(<h1 key={`h-${key++}`} className="md-h1">{content}</h1>);
      } else if (level === 2) {
        elements.push(<h2 key={`h-${key++}`} className="md-h2">{content}</h2>);
      } else {
        elements.push(<h3 key={`h-${key++}`} className="md-h3">{content}</h3>);
      }
      i++;
      continue;
    }

    // Blockquote: > text
    const bqMatch = line.match(/^>\s*(.*)$/);
    if (bqMatch) {
      const quoteLines: string[] = [bqMatch[1]];
      i++;
      while (i < lines.length && lines[i].match(/^>\s*/)) {
        quoteLines.push(lines[i].replace(/^>\s*/, ''));
        i++;
      }
      elements.push(
        <blockquote key={`bq-${key++}`} className="md-blockquote">
          {renderInlineFormatting(quoteLines.join('\n'), key++)}
        </blockquote>
      );
      continue;
    }

    // Unordered list: - item or * item
    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (ulMatch) {
      const items: string[] = [ulMatch[1]];
      i++;
      while (i < lines.length && lines[i].match(/^[\s]*[-*]\s+/)) {
        const m = lines[i].match(/^[\s]*[-*]\s+(.+)$/);
        if (m) items.push(m[1]);
        i++;
      }
      elements.push(
        <ul key={`ul-${key++}`} className="md-list">
          {items.map((item, idx) => (
            <li key={idx} className="md-list-item">{renderInlineFormatting(item, key++)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list: 1. item
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (olMatch) {
      const items: string[] = [olMatch[1]];
      i++;
      while (i < lines.length && lines[i].match(/^[\s]*\d+\.\s+/)) {
        const m = lines[i].match(/^[\s]*\d+\.\s+(.+)$/);
        if (m) items.push(m[1]);
        i++;
      }
      elements.push(
        <ol key={`ol-${key++}`} className="md-list md-list--ordered">
          {items.map((item, idx) => (
            <li key={idx} className="md-list-item">{renderInlineFormatting(item, key++)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Horizontal rule: --- or *** or ___
    if (line.match(/^[-*_]{3,}$/)) {
      elements.push(<hr key={`hr-${key++}`} className="md-hr" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={`p-${key++}`} className="md-paragraph">
        {renderInlineFormatting(line, key++)}
      </p>
    );
    i++;
  }

  return elements;
}

/**
 * Render inline formatting: bold, italic, inline code, links.
 */
function renderInlineFormatting(text: string, keyBase: number): React.ReactNode {
  // Process inline patterns via a single pass with a combined regex
  // Order matters: bold before italic, code before both
  const inlineRegex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[([^\]]+)\]\(([^)]+)\))/g;

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let partKey = 0;

  while ((m = inlineRegex.exec(text)) !== null) {
    // Add text before match
    if (m.index > lastIdx) {
      parts.push(text.slice(lastIdx, m.index));
    }

    if (m[1]) {
      // Inline code: `code`
      parts.push(
        <code key={`ic-${keyBase}-${partKey++}`} className="md-inline-code">
          {m[1].slice(1, -1)}
        </code>
      );
    } else if (m[2]) {
      // Bold: **text**
      parts.push(
        <strong key={`b-${keyBase}-${partKey++}`} className="md-bold">
          {m[2].slice(2, -2)}
        </strong>
      );
    } else if (m[3]) {
      // Italic: *text*
      parts.push(
        <em key={`i-${keyBase}-${partKey++}`} className="md-italic">
          {m[3].slice(1, -1)}
        </em>
      );
    } else if (m[4]) {
      // Link: [text](url)
      parts.push(
        <a
          key={`a-${keyBase}-${partKey++}`}
          className="md-link"
          href={m[6]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {m[5]}
        </a>
      );
    }

    lastIdx = m.index + m[0].length;
  }

  // Remaining text
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function MessageBubble({ blocks }: MessageBubbleProps) {
  const text = blocks.map((b) => b.text).join('');
  if (!text.trim()) return null;

  return (
    <div className="message-bubble">
      <div className="message-bubble__label">
        <Bot className="message-bubble__label-icon" />
        Assistant
      </div>
      <div className="message-bubble__text">
        {renderMarkdown(text)}
      </div>
    </div>
  );
}
