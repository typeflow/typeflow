//! Minimal jq parser (port of `src/converter/jq/parser.ts`): field paths,
//! object/array constructors, pipes, comparisons, arithmetic, boolean
//! operators, and common filter calls such as map/select/sort_by.

use crate::util::{js_num, js_parse_float};

#[derive(Clone, Debug)]
pub enum QNode {
    Num(f64),
    Str(String),
    Bool(bool),
    Null,
    Input,
    Field {
        target: Box<QNode>,
        name: String,
    },
    Index {
        target: Box<QNode>,
        index: Box<QNode>,
    },
    Iterate {
        target: Box<QNode>,
    },
    Call {
        name: String,
        args: Vec<QNode>,
    },
    Pipe {
        left: Box<QNode>,
        right: Box<QNode>,
    },
    Binary {
        op: String,
        left: Box<QNode>,
        right: Box<QNode>,
    },
    Unary {
        op: UnaryOp,
        expr: Box<QNode>,
    },
    Object {
        pairs: Vec<(String, QNode)>,
    },
    Array {
        items: Vec<QNode>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnaryOp {
    Not,
    Neg,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum QTokenType {
    Num,
    Str,
    Name,
    Punct,
    Eof,
}

#[derive(Clone, Debug)]
struct QToken {
    type_: QTokenType,
    value: String,
}

const PUNCT2: &[&str] = &["==", "!=", "<=", ">=", "//"];
const PUNCT1: &str = "{}[](),:.|+-*/%<>";

type QResult<T> = Result<T, String>;

fn lex(source: &str) -> QResult<Vec<QToken>> {
    let chars: Vec<char> = source.chars().collect();
    let n = chars.len();
    let mut tokens: Vec<QToken> = Vec::new();
    let mut i = 0usize;
    while i < n {
        let c = chars[i];
        if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
            i += 1;
            continue;
        }
        if c == '#' {
            let mut j = i + 1;
            while j < n && chars[j] != '\n' {
                j += 1;
            }
            i = if j >= n { n } else { j + 1 };
            continue;
        }
        if c.is_ascii_digit() {
            let mut j = i;
            while j < n
                && (chars[j].is_ascii_digit()
                    || chars[j] == '.'
                    || chars[j] == 'e'
                    || chars[j] == 'E'
                    || chars[j] == '+'
                    || chars[j] == '-')
            {
                if (chars[j] == '+' || chars[j] == '-')
                    && !(chars[j - 1] == 'e' || chars[j - 1] == 'E')
                {
                    break;
                }
                j += 1;
            }
            let raw: String = chars[i..j].iter().collect();
            tokens.push(QToken {
                type_: QTokenType::Num,
                value: js_num(js_parse_float(&raw)),
            });
            i = j;
            continue;
        }
        if c == '"' {
            let mut j = i + 1;
            let mut value = String::new();
            while j < n && chars[j] != '"' {
                if chars[j] == '\\' {
                    let escaped = chars
                        .get(j + 1)
                        .copied()
                        .ok_or_else(|| "Unterminated string literal.".to_string())?;
                    value.push(match escaped {
                        'n' => '\n',
                        't' => '\t',
                        other => other,
                    });
                    j += 2;
                } else {
                    value.push(chars[j]);
                    j += 1;
                }
            }
            if j >= n {
                return Err("Unterminated string literal.".to_string());
            }
            tokens.push(QToken {
                type_: QTokenType::Str,
                value,
            });
            i = j + 1;
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut j = i;
            while j < n && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            tokens.push(QToken {
                type_: QTokenType::Name,
                value: chars[i..j].iter().collect(),
            });
            i = j;
            continue;
        }
        if i + 1 < n {
            let two: String = chars[i..i + 2].iter().collect();
            if PUNCT2.contains(&two.as_str()) {
                tokens.push(QToken {
                    type_: QTokenType::Punct,
                    value: two,
                });
                i += 2;
                continue;
            }
        }
        if PUNCT1.contains(c) {
            tokens.push(QToken {
                type_: QTokenType::Punct,
                value: c.to_string(),
            });
            i += 1;
            continue;
        }
        return Err(format!("Unexpected character '{}'.", c));
    }
    tokens.push(QToken {
        type_: QTokenType::Eof,
        value: String::new(),
    });
    Ok(tokens)
}

struct QParser {
    tokens: Vec<QToken>,
    pos: usize,
}

impl QParser {
    fn peek(&self) -> &QToken {
        &self.tokens[self.pos]
    }

    fn next(&mut self) -> QToken {
        let token = self.peek().clone();
        if token.type_ != QTokenType::Eof {
            self.pos += 1;
        }
        token
    }

    fn at(&self, value: &str) -> bool {
        let token = self.peek();
        (token.type_ == QTokenType::Punct || token.type_ == QTokenType::Name)
            && token.value == value
    }

    fn eat(&mut self, value: &str) -> bool {
        if !self.at(value) {
            return false;
        }
        self.pos += 1;
        true
    }

    fn expect(&mut self, value: &str) -> QResult<()> {
        if !self.eat(value) {
            let found = if self.peek().value.is_empty() {
                "end of input".to_string()
            } else {
                self.peek().value.clone()
            };
            return Err(format!("Expected '{}' but found '{}'.", value, found));
        }
        Ok(())
    }

    fn parse(&mut self) -> QResult<QNode> {
        let expr = self.parse_pipe()?;
        if self.peek().type_ != QTokenType::Eof {
            return Err(format!(
                "Unsupported jq construct near '{}'.",
                self.peek().value
            ));
        }
        Ok(expr)
    }

    fn parse_pipe(&mut self) -> QResult<QNode> {
        let mut left = self.parse_binary_level(0)?;
        while self.eat("|") {
            left = QNode::Pipe {
                left: Box::new(left),
                right: Box::new(self.parse_binary_level(0)?),
            };
        }
        Ok(left)
    }

    /// `//` → or → and → comparison → additive → multiplicative.
    fn parse_binary_level(&mut self, level: usize) -> QResult<QNode> {
        const LEVELS: &[&[&str]] = &[
            &["//"],
            &["or"],
            &["and"],
            &["==", "!=", "<", "<=", ">", ">="],
            &["+", "-"],
            &["*", "/", "%"],
        ];
        if level >= LEVELS.len() {
            return self.parse_unary();
        }
        let ops = LEVELS[level];
        let mut left = self.parse_binary_level(level + 1)?;
        loop {
            let token = self.peek();
            let is_op = (token.type_ == QTokenType::Punct || token.type_ == QTokenType::Name)
                && ops.contains(&token.value.as_str());
            if !is_op {
                return Ok(left);
            }
            let op = self.next().value;
            left = QNode::Binary {
                op,
                left: Box::new(left),
                right: Box::new(self.parse_binary_level(level + 1)?),
            };
        }
    }

    fn parse_unary(&mut self) -> QResult<QNode> {
        if self.eat("not") {
            return Ok(QNode::Unary {
                op: UnaryOp::Not,
                expr: Box::new(self.parse_unary()?),
            });
        }
        if self.eat("-") {
            return Ok(QNode::Unary {
                op: UnaryOp::Neg,
                expr: Box::new(self.parse_unary()?),
            });
        }
        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> QResult<QNode> {
        let mut expr = self.parse_primary()?;
        loop {
            if self.eat(".") {
                let token = self.peek().clone();
                if token.type_ == QTokenType::Name || token.type_ == QTokenType::Str {
                    self.next();
                    expr = QNode::Field {
                        target: Box::new(expr),
                        name: token.value,
                    };
                    continue;
                }
                if self.at("[") {
                    continue;
                }
                return Err(format!(
                    "Unsupported path step after '.': '{}'.",
                    token.value
                ));
            }
            if self.eat("[") {
                if self.eat("]") {
                    expr = QNode::Iterate {
                        target: Box::new(expr),
                    };
                    continue;
                }
                let index = self.parse_pipe()?;
                self.expect("]")?;
                expr = QNode::Index {
                    target: Box::new(expr),
                    index: Box::new(index),
                };
                continue;
            }
            return Ok(expr);
        }
    }

    fn parse_primary(&mut self) -> QResult<QNode> {
        let token = self.peek().clone();
        if token.type_ == QTokenType::Num {
            self.next();
            return Ok(QNode::Num(token.value.parse::<f64>().unwrap_or(f64::NAN)));
        }
        if token.type_ == QTokenType::Str {
            self.next();
            return Ok(QNode::Str(token.value));
        }
        if token.type_ == QTokenType::Name {
            self.next();
            if token.value == "true" || token.value == "false" {
                return Ok(QNode::Bool(token.value == "true"));
            }
            if token.value == "null" {
                return Ok(QNode::Null);
            }
            if self.eat("(") {
                let mut args: Vec<QNode> = Vec::new();
                while !self.at(")") {
                    args.push(self.parse_pipe()?);
                    if !self.eat(",") {
                        break;
                    }
                }
                self.expect(")")?;
                return Ok(QNode::Call {
                    name: token.value,
                    args,
                });
            }
            return Ok(QNode::Call {
                name: token.value,
                args: Vec::new(),
            });
        }
        if self.eat(".") {
            let mut expr = QNode::Input;
            let next = self.peek().clone();
            if next.type_ == QTokenType::Name || next.type_ == QTokenType::Str {
                self.next();
                expr = QNode::Field {
                    target: Box::new(expr),
                    name: next.value,
                };
            }
            return Ok(expr);
        }
        if self.eat("{") {
            return self.parse_object_body();
        }
        if self.eat("[") {
            let mut items: Vec<QNode> = Vec::new();
            while !self.at("]") {
                items.push(self.parse_pipe()?);
                if !self.eat(",") {
                    break;
                }
            }
            self.expect("]")?;
            return Ok(QNode::Array { items });
        }
        if self.eat("(") {
            let expr = self.parse_pipe()?;
            self.expect(")")?;
            return Ok(expr);
        }
        let found = if token.value.is_empty() {
            "end of input".to_string()
        } else {
            token.value
        };
        Err(format!("Unsupported jq construct near '{}'.", found))
    }

    fn parse_object_body(&mut self) -> QResult<QNode> {
        let mut pairs: Vec<(String, QNode)> = Vec::new();
        while !self.at("}") {
            let key = self.peek().clone();
            if key.type_ != QTokenType::Name && key.type_ != QTokenType::Str {
                return Err(
                    "Only literal object keys are supported by the jq converter.".to_string(),
                );
            }
            self.next();
            if self.eat(":") {
                pairs.push((key.value, self.parse_pipe()?));
            } else {
                pairs.push((
                    key.value.clone(),
                    QNode::Field {
                        target: Box::new(QNode::Input),
                        name: key.value,
                    },
                ));
            }
            if !self.eat(",") {
                break;
            }
        }
        self.expect("}")?;
        Ok(QNode::Object { pairs })
    }
}

pub fn parse_jq(source: &str) -> QResult<QNode> {
    let tokens = lex(source)?;
    QParser { tokens, pos: 0 }.parse()
}
