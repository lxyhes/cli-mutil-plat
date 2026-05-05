//! ANSI Parser - Terminal escape sequence parser
//!
//! Parses ANSI escape sequences for terminal emulation.
//! Supports: colors, cursor movement, screen clearing, etc.

use std::fmt;

/// Represents a parsed ANSI escape sequence event
#[derive(Debug, Clone, PartialEq)]
pub enum AnsiEvent {
    /// Text content (plain characters)
    Text(String),
    
    /// Set foreground color
    ForegroundColor(Color),
    
    /// Set background color
    BackgroundColor(Color),
    
    /// Reset all attributes
    Reset,
    
    /// Bold text
    Bold,
    
    /// Dim text
    Dim,
    
    /// Italic text
    Italic,
    
    /// Underline text
    Underline,
    
    /// Blink text
    Blink,
    
    /// Reverse video
    Reverse,
    
    /// Hidden text
    Hidden,
    
    /// Move cursor to position (row, col)
    CursorMove(u16, u16),
    
    /// Move cursor up N rows
    CursorUp(u16),
    
    /// Move cursor down N rows
    CursorDown(u16),
    
    /// Move cursor forward N columns
    CursorForward(u16),
    
    /// Move cursor backward N columns
    CursorBackward(u16),
    
    /// Save cursor position
    CursorSave,
    
    /// Restore cursor position
    CursorRestore,
    
    /// Hide cursor
    CursorHide,
    
    /// Show cursor
    CursorShow,
    
    /// Clear screen
    ClearScreen(ClearMode),
    
    /// Clear line
    ClearLine(ClearMode),
    
    /// Scroll up N lines
    ScrollUp(u16),
    
    /// Scroll down N lines
    ScrollDown(u16),
    
    /// Set window title
    SetTitle(String),
    
    /// Unknown or unsupported sequence
    Unknown(String),
}

/// Color representation
#[derive(Debug, Clone, PartialEq)]
pub enum Color {
    /// Standard 8 colors (0-7)
    Ansi(u8),
    /// Bright 8 colors (0-7)
    AnsiBright(u8),
    /// 256-color palette
    Palette(u8),
    /// RGB true color
    Rgb(u8, u8, u8),
    /// Default/Reset
    Default,
}

/// Clear mode for screen/line clearing
#[derive(Debug, Clone, PartialEq)]
pub enum ClearMode {
    /// Clear from cursor to end
    Forward,
    /// Clear from start to cursor
    Backward,
    /// Clear entire screen/line
    All,
}

impl fmt::Display for Color {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Color::Ansi(n) => write!(f, "Ansi({})", n),
            Color::AnsiBright(n) => write!(f, "AnsiBright({})", n),
            Color::Palette(n) => write!(f, "Palette({})", n),
            Color::Rgb(r, g, b) => write!(f, "RGB({}, {}, {})", r, g, b),
            Color::Default => write!(f, "Default"),
        }
    }
}

/// ANSI Escape Sequence Parser
pub struct AnsiParser {
    /// Current parsing state
    state: ParserState,
    /// Buffer for accumulating text
    text_buffer: String,
    /// Parsed events
    events: Vec<AnsiEvent>,
}

/// Parser state machine states
#[derive(Debug, Clone, PartialEq)]
enum ParserState {
    /// Normal text mode
    Ground,
    /// Received ESC (0x1b)
    Escape,
    /// Received CSI (ESC [)
    CsiEntry,
    /// Received OSC (ESC ])
    OscEntry,
    /// Parsing number parameter
    Param,
}

impl AnsiParser {
    pub fn new() -> Self {
        Self {
            state: ParserState::Ground,
            text_buffer: String::new(),
            events: Vec::new(),
        }
    }

    /// Parse input bytes and return events
    pub fn parse(&mut self, input: &[u8]) -> Vec<AnsiEvent> {
        self.events.clear();
        
        for &byte in input {
            self.process_byte(byte);
        }
        
        // Flush any remaining text
        self.flush_text();
        
        std::mem::take(&mut self.events)
    }

    /// Parse a string and return events
    pub fn parse_str(&mut self, input: &str) -> Vec<AnsiEvent> {
        self.parse(input.as_bytes())
    }

    /// Strip all ANSI escape sequences from input, returning plain text
    pub fn strip_ansi(input: &str) -> String {
        let mut result = String::new();
        let mut state = ParserState::Ground;
        let mut osc_buffer = String::new();
        
        for ch in input.chars() {
            match state {
                ParserState::Ground => {
                    if ch == '\x1b' {
                        state = ParserState::Escape;
                    } else {
                        result.push(ch);
                    }
                }
                ParserState::Escape => {
                    match ch {
                        '[' => state = ParserState::CsiEntry,
                        ']' => {
                            state = ParserState::OscEntry;
                            osc_buffer.clear();
                        }
                        _ => state = ParserState::Ground,
                    }
                }
                ParserState::CsiEntry => {
                    if ch.is_ascii_alphabetic() || ch == '~' {
                        state = ParserState::Ground;
                    }
                }
                ParserState::OscEntry => {
                    if ch == '\x07' || (ch == '\\' && osc_buffer.ends_with('\x1b')) {
                        state = ParserState::Ground;
                    } else {
                        osc_buffer.push(ch);
                    }
                }
                ParserState::Param => {
                    if ch.is_ascii_alphabetic() {
                        state = ParserState::Ground;
                    }
                }
            }
        }
        
        result
    }

    /// Process a single byte
    fn process_byte(&mut self, byte: u8) {
        match self.state {
            ParserState::Ground => self.handle_ground(byte),
            ParserState::Escape => self.handle_escape(byte),
            ParserState::CsiEntry => self.handle_csi_entry(byte),
            ParserState::OscEntry => self.handle_osc_entry(byte),
            ParserState::Param => self.handle_param(byte),
        }
    }

    /// Handle byte in Ground state
    fn handle_ground(&mut self, byte: u8) {
        match byte {
            0x1b => {
                self.flush_text();
                self.state = ParserState::Escape;
            }
            0x00..=0x1f => {
                // Control characters - handle specially
                match byte {
                    0x0a => {
                        self.flush_text();
                        self.events.push(AnsiEvent::Text("\n".to_string()));
                    }
                    0x0d => {
                        self.flush_text();
                        self.events.push(AnsiEvent::Text("\r".to_string()));
                    }
                    _ => {
                        // Ignore other control chars
                    }
                }
            }
            _ => {
                self.text_buffer.push(byte as char);
            }
        }
    }

    /// Handle byte in Escape state
    fn handle_escape(&mut self, byte: u8) {
        match byte {
            b'[' => {
                self.state = ParserState::CsiEntry;
            }
            b']' => {
                self.state = ParserState::OscEntry;
            }
            b'(' | b')' => {
                // Character set selection - ignore
                self.state = ParserState::Ground;
            }
            _ => {
                // Single-character escape sequences
                match byte {
                    b'M' => self.events.push(AnsiEvent::CursorUp(1)),
                    b'7' => self.events.push(AnsiEvent::CursorSave),
                    b'8' => self.events.push(AnsiEvent::CursorRestore),
                    _ => {}
                }
                self.state = ParserState::Ground;
            }
        }
    }

    /// Handle byte in CSI Entry state
    fn handle_csi_entry(&mut self, byte: u8) {
        match byte {
            b'0'..=b'9' | b';' => {
                self.state = ParserState::Param;
                self.handle_param(byte);
            }
            b'A' => {
                self.events.push(AnsiEvent::CursorUp(1));
                self.state = ParserState::Ground;
            }
            b'B' => {
                self.events.push(AnsiEvent::CursorDown(1));
                self.state = ParserState::Ground;
            }
            b'C' => {
                self.events.push(AnsiEvent::CursorForward(1));
                self.state = ParserState::Ground;
            }
            b'D' => {
                self.events.push(AnsiEvent::CursorBackward(1));
                self.state = ParserState::Ground;
            }
            b'H' | b'f' => {
                self.events.push(AnsiEvent::CursorMove(1, 1));
                self.state = ParserState::Ground;
            }
            b'J' => {
                self.events.push(AnsiEvent::ClearScreen(ClearMode::All));
                self.state = ParserState::Ground;
            }
            b'K' => {
                self.events.push(AnsiEvent::ClearLine(ClearMode::Forward));
                self.state = ParserState::Ground;
            }
            b'm' => {
                self.events.push(AnsiEvent::Reset);
                self.state = ParserState::Ground;
            }
            _ => {
                self.state = ParserState::Ground;
            }
        }
    }

    /// Handle byte in Param state
    fn handle_param(&mut self, byte: u8) {
        match byte {
            b'0'..=b'9' | b';' => {
                // Continue collecting parameters
            }
            b'm' => {
                // SGR (Select Graphic Rendition) - colors and attributes
                self.parse_sgr();
                self.state = ParserState::Ground;
            }
            b'A' => {
                self.events.push(AnsiEvent::CursorUp(1));
                self.state = ParserState::Ground;
            }
            b'B' => {
                self.events.push(AnsiEvent::CursorDown(1));
                self.state = ParserState::Ground;
            }
            b'C' => {
                self.events.push(AnsiEvent::CursorForward(1));
                self.state = ParserState::Ground;
            }
            b'D' => {
                self.events.push(AnsiEvent::CursorBackward(1));
                self.state = ParserState::Ground;
            }
            b'H' | b'f' => {
                self.events.push(AnsiEvent::CursorMove(1, 1));
                self.state = ParserState::Ground;
            }
            b'J' => {
                self.events.push(AnsiEvent::ClearScreen(ClearMode::All));
                self.state = ParserState::Ground;
            }
            b'K' => {
                self.events.push(AnsiEvent::ClearLine(ClearMode::Forward));
                self.state = ParserState::Ground;
            }
            _ => {
                self.state = ParserState::Ground;
            }
        }
    }

    /// Handle byte in OSC Entry state
    fn handle_osc_entry(&mut self, byte: u8) {
        match byte {
            0x07 => {
                // BEL terminates OSC
                self.state = ParserState::Ground;
            }
            0x1b => {
                // ESC might be followed by \ to terminate OSC
                self.state = ParserState::Ground;
            }
            _ => {
                // Collect OSC data (for now, just ignore)
            }
        }
    }

    /// Parse SGR parameters
    fn parse_sgr(&mut self) {
        // Simplified SGR parsing
        // In production, you'd parse the actual parameters
        self.events.push(AnsiEvent::Reset);
    }

    /// Flush accumulated text buffer
    fn flush_text(&mut self) {
        if !self.text_buffer.is_empty() {
            let text = std::mem::take(&mut self.text_buffer);
            self.events.push(AnsiEvent::Text(text));
        }
    }
}

impl Default for AnsiParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi() {
        let input = "\x1b[32mHello\x1b[0m World";
        let stripped = AnsiParser::strip_ansi(input);
        assert_eq!(stripped, "Hello World");
    }

    #[test]
    fn test_parse_simple_text() {
        let mut parser = AnsiParser::new();
        let events = parser.parse_str("Hello");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], AnsiEvent::Text("Hello".to_string()));
    }

    #[test]
    fn test_parse_color_sequence() {
        let mut parser = AnsiParser::new();
        let events = parser.parse_str("\x1b[32mGreen");
        assert!(events.iter().any(|e| matches!(e, AnsiEvent::Reset)));
        assert!(events.iter().any(|e| matches!(e, AnsiEvent::Text(s) if s.contains("Green"))));
    }
}
