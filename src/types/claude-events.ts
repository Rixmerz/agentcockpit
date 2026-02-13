// Claude CLI JSON streaming event types
// Based on `claude -p --output-format stream-json --verbose` output

// ============================================
// Content Block Types (Anthropic API format)
// ============================================

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = TextContentBlock | ToolUseContentBlock;

// Tool result content (in user messages)
export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

// ============================================
// System Event Types
// ============================================

export interface SystemHookStartedEvent {
  type: 'system';
  subtype: 'hook_started';
  hook_id: string;
  hook_name: string;
}

export interface SystemHookResponseEvent {
  type: 'system';
  subtype: 'hook_response';
  hook_id: string;
  exit_code: number;
  output: string;
}

export interface SystemInitEvent {
  type: 'system';
  subtype: 'init';
  tools: string[];
  mcp_servers: string[];
  model: string;
  session_id: string;
  agents?: string[];
  skills?: string[];
}

export type SystemEvent =
  | SystemHookStartedEvent
  | SystemHookResponseEvent
  | SystemInitEvent;

// ============================================
// Assistant Event
// ============================================

export interface AssistantMessage {
  role: 'assistant';
  content: ContentBlock[];
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface AssistantEvent {
  type: 'assistant';
  message: AssistantMessage;
}

// ============================================
// User Event (tool results)
// ============================================

export interface UserMessage {
  role: 'user';
  content: ToolResultContentBlock[];
}

export interface UserEvent {
  type: 'user';
  message: UserMessage;
}

// ============================================
// Result Event
// ============================================

export interface ResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  total_cost_usd: number;
  duration_ms: number;
  duration_api_ms?: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  session_id: string;
  num_turns?: number;
  result?: string;
  error?: string;
}

// ============================================
// Union Type
// ============================================

export type ClaudeStreamEvent =
  | SystemEvent
  | AssistantEvent
  | UserEvent
  | ResultEvent;
