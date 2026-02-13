import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Cpu, ArrowDown } from 'lucide-react';
import type {
  ClaudeStreamEvent,
  AssistantEvent,
  UserEvent,
  SystemInitEvent,
  TextContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
} from '../../types/claude-events';
import type { SessionStatus, CostInfo } from '../../hooks/useClaudeStream';
import type { ClaudeSessionStatus } from '../../types';
import { MessageBubble } from './MessageBubble';
import { ToolUseCard } from './ToolUseCard';
import { SessionStatusBar } from './SessionStatusBar';
import { ClaudeInputBar } from './ClaudeInputBar';
import '../../styles/components/claude-session.css';

interface ClaudeSessionViewProps {
  events: ClaudeStreamEvent[];
  status: SessionStatus;
  cost: CostInfo;
  ptyId: number;
  sessionStatus: ClaudeSessionStatus;
}

/**
 * Build a map from tool_use_id → { content, isError } from UserEvent tool_result blocks.
 */
function buildToolResultMap(events: ClaudeStreamEvent[]): Map<string, { content: string; isError: boolean }> {
  const map = new Map<string, { content: string; isError: boolean }>();
  for (const event of events) {
    if (event.type !== 'user') continue;
    const userEvent = event as UserEvent;
    for (const block of userEvent.message.content) {
      if (block.type === 'tool_result') {
        const tb = block as ToolResultContentBlock;
        map.set(tb.tool_use_id, { content: tb.content, isError: false });
      }
    }
  }
  return map;
}

/**
 * Extract the system.init event if present.
 */
function findInitEvent(events: ClaudeStreamEvent[]): SystemInitEvent | null {
  for (const event of events) {
    if (event.type === 'system' && 'subtype' in event && event.subtype === 'init') {
      return event as SystemInitEvent;
    }
  }
  return null;
}

export function ClaudeSessionView({ events, status, cost, ptyId, sessionStatus }: ClaudeSessionViewProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Detect system.init
  const initEvent = useMemo(() => findInitEvent(events), [events]);

  // Build tool result lookup
  const toolResultMap = useMemo(() => buildToolResultMap(events), [events]);

  // Auto-scroll to bottom when new events arrive (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, userScrolledUp]);

  // Track user scroll position
  const handleScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distanceFromBottom > 50);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUserScrolledUp(false);
  }, []);

  // Render content blocks from assistant events
  const renderAssistantEvent = (event: AssistantEvent, eventIndex: number) => {
    const elements: React.ReactNode[] = [];
    const textBlocks: TextContentBlock[] = [];

    for (let i = 0; i < event.message.content.length; i++) {
      const block = event.message.content[i];

      if (block.type === 'text') {
        textBlocks.push(block);
      } else if (block.type === 'tool_use') {
        // Flush accumulated text blocks first
        if (textBlocks.length > 0) {
          elements.push(
            <MessageBubble key={`text-${eventIndex}-${i}`} blocks={[...textBlocks]} />
          );
          textBlocks.length = 0;
        }

        const tb = block as ToolUseContentBlock;
        const result = toolResultMap.get(tb.id);
        const toolStatus = result ? 'success' : 'running';

        elements.push(
          <ToolUseCard
            key={`tool-${eventIndex}-${tb.id}`}
            toolUse={tb}
            result={result?.content}
            status={toolStatus}
          />
        );
      }
    }

    // Flush remaining text blocks
    if (textBlocks.length > 0) {
      elements.push(
        <MessageBubble key={`text-${eventIndex}-end`} blocks={textBlocks} />
      );
    }

    return elements;
  };

  // Render all events in order
  const renderEvents = () => {
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (event.type === 'assistant') {
        elements.push(...renderAssistantEvent(event as AssistantEvent, i));
      }
      // UserEvents (tool results) are handled via toolResultMap lookup — not rendered directly
      // SystemEvents (init) rendered as header above
      // ResultEvent handled by SessionStatusBar footer
    }

    return elements;
  };

  if (events.length === 0) {
    return (
      <div className="claude-session">
        <div className="claude-session__empty">
          {status === 'running' ? 'Waiting for response\u2026' : 'No events yet'}
        </div>
        <ClaudeInputBar ptyId={ptyId} status={sessionStatus} />
        <SessionStatusBar status={status} cost={cost} model={initEvent?.model} />
      </div>
    );
  }

  return (
    <div className="claude-session">
      <div
        className="claude-session__messages"
        ref={messagesRef}
        onScroll={handleScroll}
      >
        {/* System init header */}
        {initEvent && (
          <div className="claude-session__init">
            <Cpu className="claude-session__init-icon" />
            <span className="claude-session__init-model">{initEvent.model}</span>
            <span className="claude-session__init-tools">
              {initEvent.tools.length} tools
              {initEvent.mcp_servers.length > 0 && ` \u00B7 ${initEvent.mcp_servers.length} MCP servers`}
            </span>
          </div>
        )}

        {renderEvents()}

        {/* Scroll anchor */}
        <div ref={bottomRef} className="claude-session__scroll-anchor" />

        {/* Scroll-to-bottom button when user scrolled up */}
        {userScrolledUp && (
          <button
            className="claude-session__scroll-btn"
            onClick={scrollToBottom}
            title="Scroll to bottom"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>

      <ClaudeInputBar ptyId={ptyId} status={sessionStatus} />
      <SessionStatusBar status={status} cost={cost} model={initEvent?.model} />
    </div>
  );
}
