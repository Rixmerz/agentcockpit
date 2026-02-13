import { useState, useCallback, useRef } from 'react';
import { Send } from 'lucide-react';
import { ptyWrite } from '../../services/tauriService';
import type { ClaudeSessionStatus } from '../../types';

interface ClaudeInputBarProps {
  ptyId: number;
  status: ClaudeSessionStatus;
}

export function ClaudeInputBar({ ptyId, status }: ClaudeInputBarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isDisabled = status === 'completed' || status === 'error';

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isDisabled) return;

    const message = JSON.stringify({
      type: 'user',
      content: [{ type: 'text', text }],
    });

    try {
      await ptyWrite(ptyId, message + '\n');
      setInput('');
    } catch (err) {
      console.error('[ClaudeInputBar] Failed to write to PTY:', err);
    }
  }, [input, ptyId, isDisabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="claude-input-bar">
      <textarea
        ref={inputRef}
        className="claude-input-bar__input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isDisabled ? 'Session ended' : 'Send a follow-up message\u2026'}
        disabled={isDisabled}
        rows={1}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        className="claude-input-bar__send"
        onClick={handleSubmit}
        disabled={isDisabled || !input.trim()}
        title="Send message"
      >
        <Send size={14} />
      </button>
    </div>
  );
}
