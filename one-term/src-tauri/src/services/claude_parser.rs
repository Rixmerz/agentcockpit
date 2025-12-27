/// Claude Output Parser
/// Parses PTY output to extract Claude-specific events (tools, thinking, responses)

use parking_lot::Mutex;

/// Types of Claude events we can detect
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum ClaudeEvent {
    /// Raw text chunk
    Text { content: String },
    /// Tool being called
    ToolCall { name: String, content: String },
    /// Tool result
    ToolResult { content: String },
    /// Thinking/reasoning block
    Thinking { content: String },
    /// File being read
    FileRead { path: String },
    /// File being edited
    FileEdit { path: String },
    /// Command being executed
    CommandExec { command: String },
    /// Response text
    Response { content: String },
    /// Status change (idle, working, etc.)
    Status { status: String },
}

/// Parser state
#[derive(Debug, Clone, PartialEq)]
enum ParserState {
    Idle,
    InToolCall,
    InToolResult,
    InThinking,
    InResponse,
}

/// Claude output parser
pub struct ClaudeParser {
    buffer: Mutex<String>,
    state: Mutex<ParserState>,
    current_block: Mutex<String>,
    events: Mutex<Vec<ClaudeEvent>>,
    last_processed_len: Mutex<usize>,
}

impl ClaudeParser {
    pub fn new() -> Self {
        Self {
            buffer: Mutex::new(String::new()),
            state: Mutex::new(ParserState::Idle),
            current_block: Mutex::new(String::new()),
            events: Mutex::new(Vec::new()),
            last_processed_len: Mutex::new(0),
        }
    }

    /// Flush accumulated block as an event
    fn flush_block(state: &ParserState, block: &str, events: &mut Vec<ClaudeEvent>) {
        if block.is_empty() {
            return;
        }
        match state {
            ParserState::InToolCall => {
                events.push(ClaudeEvent::ToolCall {
                    name: "unknown".to_string(),
                    content: block.to_string(),
                });
            }
            ParserState::InToolResult => {
                events.push(ClaudeEvent::ToolResult {
                    content: block.to_string(),
                });
            }
            ParserState::InThinking => {
                events.push(ClaudeEvent::Thinking {
                    content: block.to_string(),
                });
            }
            _ => {}
        }
    }

    /// Strip ANSI escape codes and control characters from text
    fn strip_ansi(text: &str) -> String {
        let mut result = String::new();
        let mut chars = text.chars().peekable();

        while let Some(c) = chars.next() {
            if c == '\x1b' {
                // ESC sequence
                match chars.peek() {
                    Some('[') => {
                        chars.next(); // consume '['
                        // CSI sequence - skip until final byte (letter)
                        while let Some(&next) = chars.peek() {
                            chars.next();
                            if next.is_ascii_alphabetic() {
                                break;
                            }
                        }
                    }
                    Some(']') => {
                        chars.next(); // consume ']'
                        // OSC sequence - skip until BEL or ST
                        while let Some(&next) = chars.peek() {
                            chars.next();
                            if next == '\x07' || next == '\\' {
                                break;
                            }
                        }
                    }
                    Some('(') | Some(')') => {
                        chars.next(); // consume designator
                        chars.next(); // consume charset
                    }
                    _ => {
                        // Other escape - skip one char
                        chars.next();
                    }
                }
            } else if c == '\r' {
                // Skip carriage return
                continue;
            } else if c.is_control() && c != '\n' && c != '\t' {
                // Skip other control characters
                continue;
            } else {
                result.push(c);
            }
        }

        result
    }

    /// Process incoming PTY data
    pub fn process(&self, data: &[u8]) -> Vec<ClaudeEvent> {
        let text = String::from_utf8_lossy(data);
        let clean_text = Self::strip_ansi(&text);

        let mut buffer = self.buffer.lock();
        let mut last_len = self.last_processed_len.lock();

        buffer.push_str(&clean_text);

        let mut events = Vec::new();
        let mut state = self.state.lock();
        let mut current_block = self.current_block.lock();

        // Only process new content (after last_processed_len)
        let new_content = if *last_len < buffer.len() {
            // Find a safe char boundary
            let mut start = *last_len;
            while start > 0 && !buffer.is_char_boundary(start) {
                start -= 1;
            }
            &buffer[start..]
        } else {
            ""
        };

        // Parse only new lines
        let lines: Vec<&str> = new_content.lines().collect();

        for line in lines {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Claude response marker: ⏺ (filled circle) - can appear anywhere in line
            if trimmed.contains('⏺') {
                // Flush previous block if any
                if !current_block.is_empty() && *state != ParserState::Idle {
                    Self::flush_block(&state, &current_block, &mut events);
                    current_block.clear();
                }

                // Extract content after the marker (handle ⏺ anywhere in line)
                let content = if let Some(pos) = trimmed.find('⏺') {
                    let after_marker = &trimmed[pos + '⏺'.len_utf8()..];
                    after_marker.trim()
                } else {
                    trimmed
                };
                *state = ParserState::InResponse;

                if !content.is_empty() {
                    // Check if it's a tool call pattern
                    if content.contains("Read(") || content.starts_with("Read ") {
                        if let Some(path) = Self::extract_path(content) {
                            events.push(ClaudeEvent::FileRead { path });
                        }
                    } else if content.contains("Edit(") || content.starts_with("Edit ") {
                        if let Some(path) = Self::extract_path(content) {
                            events.push(ClaudeEvent::FileEdit { path });
                        }
                    } else if content.contains("Bash(") || content.starts_with("Bash ") {
                        if let Some(cmd) = Self::extract_command(content) {
                            events.push(ClaudeEvent::CommandExec { command: cmd });
                        }
                    } else {
                        // Regular response text - filter junk
                        if let Some(clean) = Self::extract_clean_response(content) {
                            events.push(ClaudeEvent::Response { content: clean });
                        }
                    }
                }
            }
            // Result/continuation marker: ⎿
            else if trimmed.starts_with("⎿") {
                let content = trimmed.trim_start_matches("⎿").trim();
                if !content.is_empty() {
                    events.push(ClaudeEvent::ToolResult {
                        content: content.to_string(),
                    });
                }
            }
            // Thinking block
            else if trimmed.contains("Thinking") || trimmed.starts_with("thinking") {
                *state = ParserState::InThinking;
                current_block.clear();
            }
            // Tool patterns without markers
            else if trimmed.contains("Read(") || trimmed.starts_with("Reading") {
                if let Some(path) = Self::extract_path(trimmed) {
                    events.push(ClaudeEvent::FileRead { path });
                }
            } else if trimmed.contains("Edit(") || trimmed.starts_with("Editing") {
                if let Some(path) = Self::extract_path(trimmed) {
                    events.push(ClaudeEvent::FileEdit { path });
                }
            } else if trimmed.contains("Bash(") || trimmed.starts_with("Running") {
                if let Some(cmd) = Self::extract_command(trimmed) {
                    events.push(ClaudeEvent::CommandExec { command: cmd });
                }
            }
            // Accumulate content based on state
            else {
                match *state {
                    ParserState::InResponse => {
                        // Filter junk lines before emitting
                        if let Some(clean) = Self::extract_clean_response(trimmed) {
                            events.push(ClaudeEvent::Response { content: clean });
                        }
                    }
                    ParserState::InThinking => {
                        events.push(ClaudeEvent::Thinking {
                            content: trimmed.to_string(),
                        });
                    }
                    ParserState::InToolCall | ParserState::InToolResult => {
                        current_block.push_str(trimmed);
                        current_block.push('\n');
                    }
                    ParserState::Idle => {
                        events.push(ClaudeEvent::Text {
                            content: trimmed.to_string(),
                        });
                    }
                }
            }
        }

        // Update last processed position
        *last_len = buffer.len();

        // Keep only last part of buffer to avoid memory growth
        // Must find a valid UTF-8 char boundary to avoid panics on multi-byte chars
        if buffer.len() > 10000 {
            let mut start = buffer.len().saturating_sub(5000);
            // Find nearest valid char boundary
            while start > 0 && !buffer.is_char_boundary(start) {
                start -= 1;
            }
            *buffer = buffer[start..].to_string();
            // Adjust last_len after truncation
            *last_len = buffer.len();
        }

        // Store events
        self.events.lock().extend(events.clone());

        events
    }

    /// Extract file path from tool output
    fn extract_path(text: &str) -> Option<String> {
        // Look for path patterns
        if let Some(start) = text.find('/') {
            let rest = &text[start..];
            let end = rest
                .find(|c: char| c == ')' || c == '"' || c == '\'' || c == ' ')
                .unwrap_or(rest.len());
            return Some(rest[..end].to_string());
        }
        None
    }

    /// Extract command from tool output
    fn extract_command(text: &str) -> Option<String> {
        // Look for command in Bash() or after "Running:"
        if let Some(start) = text.find("Bash(") {
            let rest = &text[start + 5..];
            if let Some(end) = rest.find(')') {
                return Some(rest[..end].to_string());
            }
        }
        if let Some(start) = text.find("Running:") {
            return Some(text[start + 8..].trim().to_string());
        }
        None
    }

    /// Check if a line is terminal UI junk
    fn is_junk_line(text: &str) -> bool {
        let trimmed = text.trim();

        // Too short
        if trimmed.len() < 3 {
            return true;
        }

        // Contains consecutive box drawing = UI line
        if trimmed.contains("──") || trimmed.contains("━━") || trimmed.contains("══") {
            return true;
        }

        // Contains ANSI code patterns that weren't fully stripped
        if trimmed.contains(";231m") || trimmed.contains(";1H") || trimmed.contains(";247m") {
            return true;
        }

        // Starts with box drawing or UI symbol
        if let Some(first_char) = trimmed.chars().next() {
            if "─│┌┐└┘├┤┬┴┼═║╔╗╚╝>✶✷✸✹✺✻✼✽✾✿·•◦✢✣✤✥✦✧✩✪✫✬✭✮✯✰✱✲✳�".contains(first_char) {
                return true;
            }
            // Starts with digit followed by ; or m (ANSI residue)
            if first_char.is_ascii_digit() {
                let rest: String = trimmed.chars().skip(1).take(5).collect();
                if rest.starts_with(';') || rest.starts_with('m') || rest.starts_with("H") {
                    return true;
                }
            }
        }

        // Contains junk text patterns
        trimmed.contains("? for shortcuts") ||
        trimmed.contains("esc to interrupt") ||
        trimmed.contains("ctrl+g") ||
        trimmed.contains("↵ send") ||
        trimmed.contains("Your rate limits") ||
        trimmed.starts_with("[one-term]") ||
        trimmed.starts_with("/model")
    }

    /// Extract clean response text, cutting at first junk character
    fn extract_clean_response(text: &str) -> Option<String> {
        let trimmed = text.trim();

        // If entire line is junk, skip
        if Self::is_junk_line(trimmed) {
            return None;
        }

        // Cut at first box/decorative character
        let mut end_pos = trimmed.len();
        for (i, c) in trimmed.char_indices() {
            if "─│┌┐└┘├┤┬┴┼═║╔╗╚╝✶✷✸✹✺✻✼✽✾✿·•◦✢✣✤✥✦✧✩✪✫✬✭✮✯✰✱✲✳�".contains(c) {
                if i > 0 {
                    end_pos = i;
                    break;
                }
            }
        }

        let clean = trimmed[..end_pos].trim();
        if clean.len() >= 2 {
            Some(clean.to_string())
        } else {
            None
        }
    }

    /// Get accumulated text buffer
    pub fn get_buffer(&self) -> String {
        self.buffer.lock().clone()
    }

    /// Get all captured events
    pub fn get_events(&self) -> Vec<ClaudeEvent> {
        self.events.lock().clone()
    }

    /// Clear buffer and events
    pub fn clear(&self) {
        self.buffer.lock().clear();
        self.events.lock().clear();
        *self.state.lock() = ParserState::Idle;
        *self.current_block.lock() = String::new();
        *self.last_processed_len.lock() = 0;
    }
}

impl Default for ClaudeParser {
    fn default() -> Self {
        Self::new()
    }
}
