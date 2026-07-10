//! Typeflow lexer (port of `src/parser/lexer.ts`). Offsets are byte indices
//! into the source; both the parser and the formatter use the same
//! convention, so spans stay self-consistent.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenType {
    Ident,
    Number,
    Str,
    Punct,
    Comment,
    Error,
    Eof,
}

#[derive(Clone, Debug)]
pub struct Token {
    pub type_: TokenType,
    pub value: String,
    pub start: usize,
    pub end: usize,
}

pub struct LexError {
    pub message: String,
}

const MULTI_PUNCT: &[&str] = &["?.", "??", "->", "==", "!=", "<=", ">=", "&&", "||"];
const SINGLE_PUNCT: &str = "{}[](),:.?|!+-*/%<>=^";

fn escape_char(c: char) -> Option<char> {
    match c {
        'n' => Some('\n'),
        't' => Some('\t'),
        'r' => Some('\r'),
        '\\' => Some('\\'),
        '"' => Some('"'),
        '\'' => Some('\''),
        _ => None,
    }
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '$'
}

fn is_ident_part(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

pub struct TokenizeOptions {
    pub include_comments: bool,
    pub tolerant: bool,
}

pub fn tokenize(source: &str, options: &TokenizeOptions) -> Result<Vec<Token>, LexError> {
    let chars: Vec<char> = source.chars().collect();
    // Byte offset of each char, plus the final length (for spans/slices).
    let mut offsets: Vec<usize> = Vec::with_capacity(chars.len() + 1);
    {
        let mut b = 0;
        for c in &chars {
            offsets.push(b);
            b += c.len_utf8();
        }
        offsets.push(source.len());
    }
    let n = chars.len();
    let mut tokens: Vec<Token> = Vec::new();
    let mut i = 0usize;

    macro_rules! fail {
        ($msg:expr, $start:expr, $end:expr) => {{
            if options.tolerant {
                let e = std::cmp::max($end, $start + 1);
                tokens.push(Token {
                    type_: TokenType::Error,
                    value: source[offsets[$start]..offsets[std::cmp::min(e, n)]].to_string(),
                    start: offsets[$start],
                    end: offsets[std::cmp::min(e, n)],
                });
                i = e;
                continue;
            }
            return Err(LexError { message: $msg });
        }};
    }

    while i < n {
        let c = chars[i];

        if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
            i += 1;
            continue;
        }
        // Comments: `//` and `#` to end of line.
        if c == '#' || (c == '/' && chars.get(i + 1) == Some(&'/')) {
            let start = i;
            while i < n && chars[i] != '\n' {
                i += 1;
            }
            if options.include_comments {
                tokens.push(Token {
                    type_: TokenType::Comment,
                    value: source[offsets[start]..offsets[i]].to_string(),
                    start: offsets[start],
                    end: offsets[i],
                });
            }
            continue;
        }

        let start = i;

        if is_ident_start(c) {
            while i < n && is_ident_part(chars[i]) {
                i += 1;
            }
            tokens.push(Token {
                type_: TokenType::Ident,
                value: source[offsets[start]..offsets[i]].to_string(),
                start: offsets[start],
                end: offsets[i],
            });
            continue;
        }

        if c.is_ascii_digit() {
            while i < n && chars[i].is_ascii_digit() {
                i += 1;
            }
            if chars.get(i) == Some(&'.') && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()) {
                i += 1;
                while i < n && chars[i].is_ascii_digit() {
                    i += 1;
                }
            }
            if chars.get(i) == Some(&'e') || chars.get(i) == Some(&'E') {
                let mut j = i + 1;
                if chars.get(j) == Some(&'+') || chars.get(j) == Some(&'-') {
                    j += 1;
                }
                if chars.get(j).is_some_and(|d| d.is_ascii_digit()) {
                    i = j;
                    while i < n && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            tokens.push(Token {
                type_: TokenType::Number,
                value: source[offsets[start]..offsets[i]].to_string(),
                start: offsets[start],
                end: offsets[i],
            });
            continue;
        }

        if c == '"' || c == '\'' {
            let quote = c;
            i += 1;
            let mut value = String::new();
            let mut closed = false;
            let mut error: Option<String> = None;
            while i < n {
                let ch = chars[i];
                if ch == quote {
                    i += 1;
                    closed = true;
                    break;
                }
                if ch == '\n' {
                    break;
                }
                if ch == '\\' {
                    let esc = chars.get(i + 1).copied();
                    match esc.and_then(escape_char) {
                        None => {
                            if error.is_none() {
                                error = Some(format!(
                                    "Unknown escape sequence '\\{}'.",
                                    esc.map(String::from).unwrap_or_default()
                                ));
                            }
                            if let Some(e) = esc {
                                value.push(e);
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        Some(mapped) => {
                            value.push(mapped);
                            i += 2;
                        }
                    }
                } else {
                    value.push(ch);
                    i += 1;
                }
            }
            if !closed && error.is_none() {
                error = Some("Unterminated string literal.".to_string());
            }
            if let Some(msg) = error {
                fail!(msg, start, i);
            }
            tokens.push(Token {
                type_: TokenType::Str,
                value,
                start: offsets[start],
                end: offsets[i],
            });
            continue;
        }

        if i + 1 < n {
            let two: String = chars[i..i + 2].iter().collect();
            if MULTI_PUNCT.contains(&two.as_str()) {
                tokens.push(Token {
                    type_: TokenType::Punct,
                    value: two,
                    start: offsets[start],
                    end: offsets[i + 2],
                });
                i += 2;
                continue;
            }
        }
        if SINGLE_PUNCT.contains(c) {
            tokens.push(Token {
                type_: TokenType::Punct,
                value: c.to_string(),
                start: offsets[start],
                end: offsets[i + 1],
            });
            i += 1;
            continue;
        }

        fail!(format!("Unexpected character '{}'.", c), i, i + 1);
    }

    tokens.push(Token {
        type_: TokenType::Eof,
        value: String::new(),
        start: source.len(),
        end: source.len(),
    });
    Ok(tokens)
}
