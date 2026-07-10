//! Minimal JSONata parser (port of `src/converter/jsonata/parser.ts`):
//! object/array constructors, paths, predicates, arithmetic, comparison and
//! boolean operators, `&` concatenation, ternaries, `$fn(...)` calls, and
//! `function($x){...}` lambdas as arguments.

use crate::util::{js_num, js_parse_float};

#[derive(Clone, Debug)]
pub enum JNode {
    Num(f64),
    Str(String),
    Bool(bool),
    Null,
    Name(String),
    /// `$`
    Context,
    /// `$$`
    Root,
    /// `%` (depth 1), `%.%` (depth 2), …
    Parent {
        depth: usize,
    },
    Dot {
        left: Box<JNode>,
        right: Box<JNode>,
    },
    Predicate {
        target: Box<JNode>,
        expr: Box<JNode>,
    },
    Call {
        name: String,
        args: Vec<JNode>,
    },
    Lambda {
        params: Vec<String>,
        body: Box<JNode>,
    },
    Bind {
        target: Box<JNode>,
        variable: String,
        op: char, // '#' | '@'
    },
    Binary {
        op: String,
        left: Box<JNode>,
        right: Box<JNode>,
    },
    Sort {
        target: Box<JNode>,
        terms: Vec<(JNode, bool)>, // (key, descending)
    },
    Block {
        bindings: Vec<(String, JNode)>,
        result: Box<JNode>,
    },
    Ternary {
        cond: Box<JNode>,
        then: Box<JNode>,
        els: Box<JNode>,
    },
    Object {
        pairs: Vec<(String, JNode)>,
    },
    Array {
        items: Vec<JNode>,
    },
    Neg {
        operand: Box<JNode>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum JTokenType {
    Num,
    Str,
    Name,
    Var,
    Punct,
    Eof,
}

#[derive(Clone, Debug)]
struct JToken {
    type_: JTokenType,
    value: String,
}

const PUNCT2: &[&str] = &["!=", "<=", ">=", ":=", "~>", "**"];
const PUNCT1: &str = "{}[](),:.?&=<>+-*/%;!@#^|";

type JResult<T> = Result<T, String>;

fn lex(source: &str) -> JResult<Vec<JToken>> {
    let chars: Vec<char> = source.chars().collect();
    let n = chars.len();
    let mut tokens: Vec<JToken> = Vec::new();
    let mut i = 0usize;
    while i < n {
        let c = chars[i];
        if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
            i += 1;
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            let mut j = i + 2;
            let mut found = None;
            while j + 1 < n {
                if chars[j] == '*' && chars[j + 1] == '/' {
                    found = Some(j);
                    break;
                }
                j += 1;
            }
            let Some(end) = found else {
                return Err("Unterminated comment.".to_string());
            };
            i = end + 2;
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
                // stop at operators that only look like number parts
                if (chars[j] == '+' || chars[j] == '-')
                    && !(chars[j - 1] == 'e' || chars[j - 1] == 'E')
                {
                    break;
                }
                j += 1;
            }
            let raw: String = chars[i..j].iter().collect();
            let value = js_parse_float(&raw);
            tokens.push(JToken {
                type_: JTokenType::Num,
                value: js_num(value),
            });
            i += raw.chars().count();
            continue;
        }
        if c == '"' || c == '\'' {
            let mut j = i + 1;
            let mut value = String::new();
            while j < n && chars[j] != c {
                if chars[j] == '\\' {
                    // Faithful port: the TS lexer appends the escaped char verbatim.
                    if let Some(&next) = chars.get(j + 1) {
                        value.push(next);
                    }
                    j += 2;
                } else {
                    value.push(chars[j]);
                    j += 1;
                }
            }
            if j >= n {
                return Err("Unterminated string literal.".to_string());
            }
            tokens.push(JToken {
                type_: JTokenType::Str,
                value,
            });
            i = j + 1;
            continue;
        }
        if c == '`' {
            let mut j = i + 1;
            let mut found = None;
            while j < n {
                if chars[j] == '`' {
                    found = Some(j);
                    break;
                }
                j += 1;
            }
            let Some(end) = found else {
                return Err("Unterminated quoted name.".to_string());
            };
            tokens.push(JToken {
                type_: JTokenType::Name,
                value: chars[i + 1..end].iter().collect(),
            });
            i = end + 1;
            continue;
        }
        if c == '$' {
            let mut j = i + 1;
            if chars.get(j) == Some(&'$') {
                j += 1;
            }
            while j < n && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            tokens.push(JToken {
                type_: JTokenType::Var,
                value: chars[i..j].iter().collect(),
            });
            i = j;
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut j = i;
            while j < n && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            tokens.push(JToken {
                type_: JTokenType::Name,
                value: chars[i..j].iter().collect(),
            });
            i = j;
            continue;
        }
        if i + 1 < n {
            let two: String = chars[i..i + 2].iter().collect();
            if PUNCT2.contains(&two.as_str()) {
                tokens.push(JToken {
                    type_: JTokenType::Punct,
                    value: two,
                });
                i += 2;
                continue;
            }
        }
        if PUNCT1.contains(c) {
            tokens.push(JToken {
                type_: JTokenType::Punct,
                value: c.to_string(),
            });
            i += 1;
            continue;
        }
        return Err(format!("Unexpected character '{}'.", c));
    }
    tokens.push(JToken {
        type_: JTokenType::Eof,
        value: String::new(),
    });
    Ok(tokens)
}

struct JParser {
    tokens: Vec<JToken>,
    pos: usize,
}

impl JParser {
    fn peek(&self) -> &JToken {
        &self.tokens[self.pos]
    }

    fn next(&mut self) -> JToken {
        let t = self.peek().clone();
        if t.type_ != JTokenType::Eof {
            self.pos += 1;
        }
        t
    }

    fn at(&self, value: &str) -> bool {
        let t = self.peek();
        (t.type_ == JTokenType::Punct || t.type_ == JTokenType::Name) && t.value == value
    }

    fn eat(&mut self, value: &str) -> bool {
        if self.at(value) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, value: &str) -> JResult<()> {
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

    fn parse(&mut self) -> JResult<JNode> {
        let expr = self.parse_expr()?;
        if self.peek().type_ != JTokenType::Eof {
            return Err(format!(
                "Unsupported JSONata construct near '{}'.",
                self.peek().value
            ));
        }
        Ok(expr)
    }

    fn parse_expr(&mut self) -> JResult<JNode> {
        self.parse_ternary()
    }

    fn parse_ternary(&mut self) -> JResult<JNode> {
        let cond = self.parse_binary_level(0)?;
        if !self.eat("?") {
            return Ok(cond);
        }
        let then = self.parse_expr()?;
        self.expect(":")?;
        let els = self.parse_expr()?;
        Ok(JNode::Ternary {
            cond: Box::new(cond),
            then: Box::new(then),
            els: Box::new(els),
        })
    }

    /// or → and → comparison → `&` concat → additive → multiplicative.
    fn parse_binary_level(&mut self, level: usize) -> JResult<JNode> {
        const LEVELS: &[&[&str]] = &[
            &["or"],
            &["and"],
            &["=", "!=", "<", "<=", ">", ">=", "in"],
            &["&"],
            &["+", "-"],
            &["*", "/", "%"],
        ];
        if level >= LEVELS.len() {
            return self.parse_unary();
        }
        let ops = LEVELS[level];
        let mut left = self.parse_binary_level(level + 1)?;
        loop {
            let t = self.peek();
            let is_word_op = t.type_ == JTokenType::Name && ops.contains(&t.value.as_str());
            let is_punct_op = t.type_ == JTokenType::Punct && ops.contains(&t.value.as_str());
            if !is_word_op && !is_punct_op {
                return Ok(left);
            }
            let op = self.next().value;
            let right = self.parse_binary_level(level + 1)?;
            left = JNode::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
    }

    fn parse_unary(&mut self) -> JResult<JNode> {
        if self.eat("-") {
            return Ok(JNode::Neg {
                operand: Box::new(self.parse_unary()?),
            });
        }
        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> JResult<JNode> {
        let mut expr = self.parse_primary()?;
        loop {
            if self.at(".") {
                self.next();
                if self.at("{") {
                    // `arr.{ ... }` — per-element object constructor (projection).
                    let right = self.parse_object()?;
                    expr = JNode::Dot {
                        left: Box::new(expr),
                        right: Box::new(right),
                    };
                    continue;
                }
                if self.at("(") {
                    // `arr.( ... )` — per-element mapping of a block/expression.
                    let right = self.parse_primary()?;
                    expr = JNode::Dot {
                        left: Box::new(expr),
                        right: Box::new(right),
                    };
                    continue;
                }
                let t = self.peek().clone();
                if t.type_ == JTokenType::Punct && t.value == "%" {
                    // `%.%`, `%.%.%`, … — a multi-level parent.
                    let JNode::Parent { depth } = expr else {
                        return Err("`.%` is only valid after a `%` parent.".to_string());
                    };
                    self.next();
                    expr = JNode::Parent { depth: depth + 1 };
                    continue;
                }
                if t.type_ != JTokenType::Name {
                    return Err(format!("Unsupported path step after '.': '{}'.", t.value));
                }
                self.next();
                expr = JNode::Dot {
                    left: Box::new(expr),
                    right: Box::new(JNode::Name(t.value)),
                };
            } else if self.at("[") {
                self.next();
                let inner = self.parse_expr()?;
                self.expect("]")?;
                expr = JNode::Predicate {
                    target: Box::new(expr),
                    expr: Box::new(inner),
                };
            } else if self.at("^") {
                // JSONata order-by: `arr^(>a, <b)`.
                self.next();
                self.expect("(")?;
                let mut terms: Vec<(JNode, bool)> = Vec::new();
                while !self.at(")") {
                    let mut descending = false;
                    if self.eat(">") {
                        descending = true;
                    } else {
                        self.eat("<");
                    }
                    terms.push((self.parse_expr()?, descending));
                    if !self.eat(",") {
                        break;
                    }
                }
                self.expect(")")?;
                if terms.is_empty() {
                    return Err("A sort `^(...)` needs at least one key.".to_string());
                }
                expr = JNode::Sort {
                    target: Box::new(expr),
                    terms,
                };
            } else if self.at("#") || self.at("@") {
                // `path#$i` / `path@$v` — positional / context variable binding.
                let op = self.next().value.chars().next().unwrap();
                let t = self.peek().clone();
                if t.type_ != JTokenType::Var {
                    return Err(format!("Expected a $variable after '{}'.", op));
                }
                self.next();
                expr = JNode::Bind {
                    target: Box::new(expr),
                    variable: t.value,
                    op,
                };
            } else {
                return Ok(expr);
            }
        }
    }

    fn parse_object(&mut self) -> JResult<JNode> {
        self.expect("{")?;
        let mut pairs: Vec<(String, JNode)> = Vec::new();
        while !self.at("}") {
            let key_tok = self.peek().clone();
            if key_tok.type_ != JTokenType::Str && key_tok.type_ != JTokenType::Name {
                return Err("Only literal object keys are supported by the converter.".to_string());
            }
            self.next();
            self.expect(":")?;
            let value = self.parse_expr()?;
            pairs.push((key_tok.value, value));
            if !self.eat(",") {
                break;
            }
        }
        self.expect("}")?;
        Ok(JNode::Object { pairs })
    }

    fn parse_primary(&mut self) -> JResult<JNode> {
        let t = self.peek().clone();
        if t.type_ == JTokenType::Num {
            self.next();
            return Ok(JNode::Num(t.value.parse::<f64>().unwrap_or(f64::NAN)));
        }
        if t.type_ == JTokenType::Str {
            self.next();
            return Ok(JNode::Str(t.value));
        }
        if t.type_ == JTokenType::Var {
            self.next();
            if t.value == "$" {
                return Ok(JNode::Context);
            }
            if t.value == "$$" {
                return Ok(JNode::Root);
            }
            // `$name(...)` is a function call; a bare `$name` is a variable.
            if self.at("(") {
                self.next();
                let mut args: Vec<JNode> = Vec::new();
                while !self.at(")") {
                    args.push(self.parse_argument()?);
                    if !self.eat(",") {
                        break;
                    }
                }
                self.expect(")")?;
                return Ok(JNode::Call {
                    name: t.value[1..].to_string(),
                    args,
                });
            }
            return Ok(JNode::Name(t.value));
        }
        if t.type_ == JTokenType::Name {
            if t.value == "true" || t.value == "false" {
                self.next();
                return Ok(JNode::Bool(t.value == "true"));
            }
            if t.value == "null" {
                self.next();
                return Ok(JNode::Null);
            }
            if t.value == "function" {
                return self.parse_lambda();
            }
            self.next();
            return Ok(JNode::Name(t.value));
        }
        if self.at("(") {
            self.next();
            // `( $x := e; ...; result )` — bindings block; plain `( expr )` is grouping.
            let mut bindings: Vec<(String, JNode)> = Vec::new();
            let result: JNode;
            loop {
                let e = self.parse_expr()?;
                if self.eat(":=") {
                    let name = match &e {
                        JNode::Name(value) if value.starts_with('$') => value.clone(),
                        _ => return Err("The left side of `:=` must be a $variable.".to_string()),
                    };
                    bindings.push((name, self.parse_expr()?));
                    if self.eat(";") {
                        continue;
                    }
                    return Err(
                        "A `( ... )` block must end with a result expression after its `$var := ...` bindings."
                            .to_string(),
                    );
                }
                if self.at(";") {
                    return Err(
                        "Only `$var := ...` statements are supported before the final expression in a `( ... )` block."
                            .to_string(),
                    );
                }
                result = e;
                break;
            }
            self.expect(")")?;
            if bindings.is_empty() {
                return Ok(result);
            }
            return Ok(JNode::Block {
                bindings,
                result: Box::new(result),
            });
        }
        // `%` in operand position is JSONata's parent operator.
        if self.at("%") {
            self.next();
            return Ok(JNode::Parent { depth: 1 });
        }
        if self.at("{") {
            return self.parse_object();
        }
        if self.at("[") {
            self.next();
            let mut items: Vec<JNode> = Vec::new();
            while !self.at("]") {
                items.push(self.parse_expr()?);
                if !self.eat(",") {
                    break;
                }
            }
            self.expect("]")?;
            return Ok(JNode::Array { items });
        }
        let found = if t.value.is_empty() {
            "end of input".to_string()
        } else {
            t.value
        };
        Err(format!("Unsupported JSONata construct near '{}'.", found))
    }

    fn parse_argument(&mut self) -> JResult<JNode> {
        if self.peek().type_ == JTokenType::Name && self.peek().value == "function" {
            return self.parse_lambda();
        }
        self.parse_expr()
    }

    fn parse_lambda(&mut self) -> JResult<JNode> {
        self.expect("function")?;
        self.expect("(")?;
        let mut params: Vec<String> = Vec::new();
        while !self.at(")") {
            let t = self.peek().clone();
            if t.type_ != JTokenType::Var {
                return Err("Lambda parameters must be $variables.".to_string());
            }
            self.next();
            params.push(t.value);
            if !self.eat(",") {
                break;
            }
        }
        self.expect(")")?;
        self.expect("{")?;
        let body = self.parse_expr()?;
        self.expect("}")?;
        Ok(JNode::Lambda {
            params,
            body: Box::new(body),
        })
    }
}

pub fn parse_jsonata(source: &str) -> JResult<JNode> {
    let tokens = lex(source)?;
    JParser { tokens, pos: 0 }.parse()
}
