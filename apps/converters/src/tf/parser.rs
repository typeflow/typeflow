//! Typeflow parser (port of `src/parser/parser.ts`) — the subset needed by
//! the formatter: full file parsing, no checker.

use super::ast::*;
use super::lexer::{tokenize, LexError, Token, TokenType, TokenizeOptions};

pub struct ParseError {
    pub message: String,
}

pub struct ParseOutcome {
    pub ast: Option<MappingFile>,
    /// First diagnostic message when parsing failed.
    pub error: Option<String>,
}

const PRIM_NAMES: &[&str] = &["string", "number", "boolean", "null", "unknown"];

pub fn parse(source: &str) -> ParseOutcome {
    let tokens = match tokenize(
        source,
        &TokenizeOptions {
            include_comments: false,
            tolerant: false,
        },
    ) {
        Ok(t) => t,
        Err(LexError { message }) => {
            return ParseOutcome {
                ast: None,
                error: Some(message),
            }
        }
    };
    let mut parser = Parser { tokens, pos: 0 };
    match parser.parse_file() {
        Ok(ast) => ParseOutcome {
            ast: Some(ast),
            error: None,
        },
        Err(ParseError { message }) => ParseOutcome {
            ast: None,
            error: Some(message),
        },
    }
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

type PResult<T> = Result<T, ParseError>;

impl Parser {
    fn peek(&self) -> &Token {
        self.peek_at(0)
    }

    fn peek_at(&self, offset: usize) -> &Token {
        let idx = std::cmp::min(self.pos + offset, self.tokens.len() - 1);
        &self.tokens[idx]
    }

    fn next(&mut self) -> Token {
        let t = self.peek().clone();
        if t.type_ != TokenType::Eof {
            self.pos += 1;
        }
        t
    }

    fn at(&self, type_: TokenType, value: &str) -> bool {
        let t = self.peek();
        t.type_ == type_ && t.value == value
    }

    fn eat(&mut self, type_: TokenType, value: &str) -> bool {
        if self.at(type_, value) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect_punct(&mut self, value: &str) -> PResult<Token> {
        if !self.at(TokenType::Punct, value) {
            return Err(self.fail(&format!("Expected '{}'.", value)));
        }
        Ok(self.next())
    }

    fn expect_ident(&mut self) -> PResult<Token> {
        if self.peek().type_ != TokenType::Ident {
            return Err(self.fail("Expected an identifier."));
        }
        Ok(self.next())
    }

    fn fail(&self, message: &str) -> ParseError {
        let t = self.peek();
        ParseError {
            message: if t.type_ == TokenType::Eof {
                format!("{} Unexpected end of file.", message)
            } else {
                message.to_string()
            },
        }
    }

    fn parse_file(&mut self) -> PResult<MappingFile> {
        let mut input: Option<InputDecl> = None;
        let mut uses: Vec<UseDecl> = Vec::new();
        let mut fns: Vec<FnDecl> = Vec::new();
        loop {
            if self.at(TokenType::Ident, "input") {
                if input.is_some() {
                    return Err(self.fail("Only one 'input' declaration is allowed in v0.1."));
                }
                input = Some(self.parse_input_decl()?);
            } else if self.at(TokenType::Ident, "use") {
                uses.push(self.parse_use_decl()?);
            } else if self.at(TokenType::Ident, "fn") {
                fns.push(self.parse_fn_decl()?);
            } else {
                break;
            }
        }
        if !self.at(TokenType::Ident, "map") {
            return Err(self.fail("Expected a 'map { ... }' block."));
        }
        self.next(); // map
        let map = self.parse_object_expr()?;
        if self.peek().type_ != TokenType::Eof {
            return Err(self.fail("Unexpected content after the 'map' block."));
        }
        Ok(MappingFile {
            input,
            uses,
            fns,
            map,
        })
    }

    fn parse_param_list(&mut self) -> PResult<Vec<UseParam>> {
        self.expect_punct("(")?;
        let mut params = Vec::new();
        while !self.at(TokenType::Punct, ")") {
            let p_tok = self.expect_ident()?;
            let optional = self.eat(TokenType::Punct, "?");
            self.expect_punct(":")?;
            let type_ = self.parse_type_expr()?;
            params.push(UseParam {
                name: p_tok.value,
                optional,
                type_,
            });
            if !self.eat(TokenType::Punct, ",") {
                break;
            }
        }
        self.expect_punct(")")?;
        Ok(params)
    }

    fn parse_signature(&mut self) -> PResult<(String, Vec<UseParam>, TypeNode, usize)> {
        let name_tok = self.expect_ident()?;
        let params = self.parse_param_list()?;
        self.expect_punct(":")?;
        let return_type = self.parse_type_expr()?;
        Ok((name_tok.value, params, return_type, name_tok.start))
    }

    fn parse_fn_decl(&mut self) -> PResult<FnDecl> {
        let kw = self.next(); // fn
        let name_tok = self.expect_ident()?;
        let params = self.parse_param_list()?;
        let mut return_type: Option<TypeNode> = None;
        if self.eat(TokenType::Punct, ":") {
            return_type = Some(self.parse_type_expr()?);
        }
        if !self.at(TokenType::Punct, "=") {
            return Err(self.fail("Expected '=' followed by the function body expression."));
        }
        self.next(); // =
        let body = self.parse_expr()?;
        let span = Span {
            start: kw.start,
            end: body.span().end,
        };
        Ok(FnDecl {
            name: name_tok.value,
            params,
            return_type,
            body,
            span,
        })
    }

    fn parse_use_decl(&mut self) -> PResult<UseDecl> {
        let kw = self.next(); // use
        let (name, params, return_type, _) = self.parse_signature()?;
        if !self.at(TokenType::Ident, "from") {
            return Err(self.fail("Expected 'from \"./module\"' after the function signature."));
        }
        self.next(); // from
        if self.peek().type_ != TokenType::Str {
            return Err(self.fail("Expected a module path string after 'from'."));
        }
        let from_tok = self.next();
        Ok(UseDecl {
            name,
            params,
            return_type,
            from: from_tok.value,
            span: Span {
                start: kw.start,
                end: from_tok.end,
            },
        })
    }

    fn parse_input_decl(&mut self) -> PResult<InputDecl> {
        let kw = self.next(); // input
        let name_tok = self.expect_ident()?;
        self.expect_punct(":")?;

        // `input user: User from "./types"` — a bare non-primitive identifier
        // followed by `from` is a type reference.
        if self.peek().type_ == TokenType::Ident
            && !PRIM_NAMES.contains(&self.peek().value.as_str())
            && self.peek_at(1).type_ == TokenType::Ident
            && self.peek_at(1).value == "from"
        {
            let type_name = self.next().value;
            self.next(); // from
            if self.peek().type_ != TokenType::Str {
                return Err(self.fail("Expected a module path string after 'from'."));
            }
            let from_tok = self.next();
            return Ok(InputDecl {
                name: name_tok.value,
                type_ref: Some((type_name, from_tok.value)),
                inline_type: None,
                span: Span {
                    start: kw.start,
                    end: from_tok.end,
                },
            });
        }

        let inline_type = self.parse_type_expr()?;
        let span = Span {
            start: kw.start,
            end: inline_type.span().end,
        };
        Ok(InputDecl {
            name: name_tok.value,
            type_ref: None,
            inline_type: Some(inline_type),
            span,
        })
    }

    // ---- Inline type syntax ----

    fn parse_type_expr(&mut self) -> PResult<TypeNode> {
        let first = self.parse_postfix_type()?;
        if !self.at(TokenType::Punct, "|") {
            return Ok(first);
        }
        let mut types = vec![first];
        while self.eat(TokenType::Punct, "|") {
            types.push(self.parse_postfix_type()?);
        }
        let span = Span {
            start: types[0].span().start,
            end: types[types.len() - 1].span().end,
        };
        Ok(TypeNode::Union { types, span })
    }

    fn parse_postfix_type(&mut self) -> PResult<TypeNode> {
        let mut t = self.parse_primary_type()?;
        while self.at(TokenType::Punct, "[")
            && self.peek_at(1).type_ == TokenType::Punct
            && self.peek_at(1).value == "]"
        {
            self.next();
            let close = self.next();
            let span = Span {
                start: t.span().start,
                end: close.end,
            };
            t = TypeNode::Array {
                element: Box::new(t),
                span,
            };
        }
        Ok(t)
    }

    fn parse_primary_type(&mut self) -> PResult<TypeNode> {
        let t = self.peek().clone();
        if t.type_ == TokenType::Ident {
            if PRIM_NAMES.contains(&t.value.as_str()) {
                self.next();
                return Ok(TypeNode::Prim {
                    name: t.value,
                    span: Span {
                        start: t.start,
                        end: t.end,
                    },
                });
            }
            if t.value == "true" || t.value == "false" {
                self.next();
                return Ok(TypeNode::Lit {
                    value: LitValue::Bool(t.value == "true"),
                    span: Span {
                        start: t.start,
                        end: t.end,
                    },
                });
            }
            return Err(self.fail(&format!(
                "Unknown type '{}'. Inline types support: string, number, boolean, null, unknown, literals, arrays, objects, and unions.",
                t.value
            )));
        }
        if t.type_ == TokenType::Str {
            self.next();
            return Ok(TypeNode::Lit {
                value: LitValue::Str(t.value),
                span: Span {
                    start: t.start,
                    end: t.end,
                },
            });
        }
        if t.type_ == TokenType::Number {
            self.next();
            return Ok(TypeNode::Lit {
                value: LitValue::Num(t.value.parse::<f64>().unwrap_or(f64::NAN)),
                span: Span {
                    start: t.start,
                    end: t.end,
                },
            });
        }
        if self.at(TokenType::Punct, "(") {
            self.next();
            let inner = self.parse_type_expr()?;
            self.expect_punct(")")?;
            return Ok(inner);
        }
        if self.at(TokenType::Punct, "{") {
            let open = self.next();
            let mut fields: Vec<TypeFieldNode> = Vec::new();
            while !self.at(TokenType::Punct, "}") {
                let name_tok = self.peek().clone();
                let name = if name_tok.type_ == TokenType::Ident || name_tok.type_ == TokenType::Str
                {
                    self.next().value
                } else {
                    return Err(self.fail("Expected a field name."));
                };
                let optional = self.eat(TokenType::Punct, "?");
                self.expect_punct(":")?;
                let type_ = self.parse_type_expr()?;
                let span = Span {
                    start: name_tok.start,
                    end: type_.span().end,
                };
                fields.push(TypeFieldNode {
                    name,
                    optional,
                    type_,
                    span,
                });
                if !self.eat(TokenType::Punct, ",") {
                    break;
                }
            }
            let close = self.expect_punct("}")?;
            return Ok(TypeNode::Object {
                fields,
                span: Span {
                    start: open.start,
                    end: close.end,
                },
            });
        }
        Err(self.fail("Expected a type."))
    }

    // ---- Expressions ----

    fn parse_object_expr(&mut self) -> PResult<ObjectExpr> {
        let open = self.expect_punct("{")?;
        let mut props: Vec<ObjectProp> = Vec::new();
        let mut lets: Vec<LetBinding> = Vec::new();
        while !self.at(TokenType::Punct, "}") {
            // `let name = expr` — keyword form only; `let: ...` stays a property.
            if self.peek().type_ == TokenType::Ident
                && self.peek().value == "let"
                && self.peek_at(1).type_ == TokenType::Ident
                && self.peek_at(1).value != "let"
                && self.peek_at(2).type_ == TokenType::Punct
                && self.peek_at(2).value == "="
            {
                let kw = self.next();
                let name_tok = self.next();
                self.expect_punct("=")?;
                let value = self.parse_expr()?;
                let span = Span {
                    start: kw.start,
                    end: value.span().end,
                };
                lets.push(LetBinding {
                    name: name_tok.value,
                    value,
                    span,
                });
                if !self.eat(TokenType::Punct, ",") {
                    break;
                }
                continue;
            }

            let name_tok = self.peek().clone();
            let name = if name_tok.type_ == TokenType::Ident || name_tok.type_ == TokenType::Str {
                self.next().value
            } else {
                return Err(self.fail("Expected a property name."));
            };
            self.expect_punct(":")?;
            let value = self.parse_expr()?;
            let span = Span {
                start: name_tok.start,
                end: value.span().end,
            };
            props.push(ObjectProp { name, value, span });
            if !self.eat(TokenType::Punct, ",") {
                break;
            }
        }
        let close = self.expect_punct("}")?;
        Ok(ObjectExpr {
            props,
            lets,
            span: Span {
                start: open.start,
                end: close.end,
            },
        })
    }

    fn parse_expr(&mut self) -> PResult<Expr> {
        self.parse_ternary()
    }

    fn parse_ternary(&mut self) -> PResult<Expr> {
        let cond = self.parse_binary_level(0)?;
        if !self.eat(TokenType::Punct, "?") {
            return Ok(cond);
        }
        let then = self.parse_expr()?;
        self.expect_punct(":")?;
        let els = self.parse_expr()?;
        let span = Span {
            start: cond.span().start,
            end: els.span().end,
        };
        Ok(Expr::Cond {
            cond: Box::new(cond),
            then: Box::new(then),
            els: Box::new(els),
            span,
        })
    }

    /// Binary levels, loosest to tightest — mirrors the TS parser's chain
    /// parseNullish → … → parseMultiplicative.
    fn parse_binary_level(&mut self, level: usize) -> PResult<Expr> {
        const LEVELS: &[&[&str]] = &[
            &["??"],
            &["||"],
            &["&&"],
            &["==", "!="],
            &["<", "<=", ">", ">="],
            &["+", "-"],
            &["*", "/", "%"],
        ];
        if level >= LEVELS.len() {
            return self.parse_unary();
        }
        let ops = LEVELS[level];
        let mut left = self.parse_binary_level(level + 1)?;
        while self.peek().type_ == TokenType::Punct && ops.contains(&self.peek().value.as_str()) {
            let op = self.next().value;
            let right = self.parse_binary_level(level + 1)?;
            let span = Span {
                start: left.span().start,
                end: right.span().end,
            };
            left = Expr::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> PResult<Expr> {
        let t = self.peek().clone();
        if self.at(TokenType::Punct, "!") || self.at(TokenType::Punct, "-") {
            self.next();
            let operand = self.parse_unary()?;
            let span = Span {
                start: t.start,
                end: operand.span().end,
            };
            return Ok(Expr::Unary {
                op: t.value.chars().next().unwrap(),
                operand: Box::new(operand),
                span,
            });
        }
        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> PResult<Expr> {
        let mut expr = self.parse_primary()?;
        loop {
            if self.at(TokenType::Punct, ".") || self.at(TokenType::Punct, "?.") {
                let optional = self.peek().value == "?.";
                self.next();
                let name_tok = self.expect_ident()?;
                let span = Span {
                    start: expr.span().start,
                    end: name_tok.end,
                };
                expr = Expr::Member {
                    object: Box::new(expr),
                    name: name_tok.value,
                    optional,
                    span,
                };
            } else if self.at(TokenType::Punct, "[") {
                self.next();
                let inner = self.parse_expr()?;
                let close = self.expect_punct("]")?;
                let span = Span {
                    start: expr.span().start,
                    end: close.end,
                };
                expr = Expr::Bracket {
                    object: Box::new(expr),
                    inner: Box::new(inner),
                    span,
                };
            } else if self.at(TokenType::Punct, "^") {
                self.next();
                self.expect_punct("(")?;
                let mut terms: Vec<SortTerm> = Vec::new();
                while !self.at(TokenType::Punct, ")") {
                    let mut descending = false;
                    if self.at(TokenType::Punct, ">") {
                        self.next();
                        descending = true;
                    } else if self.at(TokenType::Punct, "<") {
                        self.next();
                    }
                    terms.push(SortTerm {
                        key: self.parse_expr()?,
                        descending,
                    });
                    if !self.eat(TokenType::Punct, ",") {
                        break;
                    }
                }
                let close = self.expect_punct(")")?;
                if terms.is_empty() {
                    return Err(self.fail("A sort '^(...)' needs at least one key."));
                }
                let span = Span {
                    start: expr.span().start,
                    end: close.end,
                };
                expr = Expr::Sort {
                    object: Box::new(expr),
                    terms,
                    span,
                };
            } else if self.at(TokenType::Punct, "->") {
                self.next();
                // Optional element alias / index binder, only when followed by
                // the projection body.
                let mut binder: Option<String> = None;
                let mut index_binder: Option<String> = None;
                if self.peek().type_ == TokenType::Ident
                    && self.peek_at(1).type_ == TokenType::Punct
                    && (self.peek_at(1).value == "{" || self.peek_at(1).value == ",")
                {
                    binder = Some(self.next().value);
                    if self.eat(TokenType::Punct, ",") {
                        index_binder = Some(self.expect_ident()?.value);
                    }
                }
                let body = self.parse_object_expr()?;
                let span = Span {
                    start: expr.span().start,
                    end: body.span.end,
                };
                expr = Expr::Project {
                    object: Box::new(expr),
                    binder,
                    index_binder,
                    body,
                    span,
                };
            } else {
                return Ok(expr);
            }
        }
    }

    fn parse_primary(&mut self) -> PResult<Expr> {
        let t = self.peek().clone();

        if t.type_ == TokenType::Number {
            self.next();
            return Ok(Expr::Lit {
                value: LitValue::Num(t.value.parse::<f64>().unwrap_or(f64::NAN)),
                span: Span {
                    start: t.start,
                    end: t.end,
                },
            });
        }
        if t.type_ == TokenType::Str {
            self.next();
            return Ok(Expr::Lit {
                value: LitValue::Str(t.value),
                span: Span {
                    start: t.start,
                    end: t.end,
                },
            });
        }
        if t.type_ == TokenType::Ident {
            if t.value == "true" || t.value == "false" {
                self.next();
                return Ok(Expr::Lit {
                    value: LitValue::Bool(t.value == "true"),
                    span: Span {
                        start: t.start,
                        end: t.end,
                    },
                });
            }
            if t.value == "null" {
                self.next();
                return Ok(Expr::Lit {
                    value: LitValue::Null,
                    span: Span {
                        start: t.start,
                        end: t.end,
                    },
                });
            }
            self.next();
            // Function call: `name(args)`
            if self.at(TokenType::Punct, "(") {
                self.next();
                let mut args: Vec<Expr> = Vec::new();
                while !self.at(TokenType::Punct, ")") {
                    args.push(self.parse_expr()?);
                    if !self.eat(TokenType::Punct, ",") {
                        break;
                    }
                }
                let close = self.expect_punct(")")?;
                return Ok(Expr::Call {
                    name: t.value,
                    args,
                    span: Span {
                        start: t.start,
                        end: close.end,
                    },
                });
            }
            return Ok(Expr::Ident {
                name: t.value,
                span: Span {
                    start: t.start,
                    end: t.end,
                },
            });
        }
        if self.at(TokenType::Punct, "(") {
            self.next();
            let mut inner = self.parse_expr()?;
            let close = self.expect_punct(")")?;
            inner.set_span(Span {
                start: t.start,
                end: close.end,
            });
            return Ok(inner);
        }
        if self.at(TokenType::Punct, "{") {
            return Ok(Expr::Object(self.parse_object_expr()?));
        }
        if self.at(TokenType::Punct, "[") {
            self.next();
            let mut elements: Vec<Expr> = Vec::new();
            while !self.at(TokenType::Punct, "]") {
                elements.push(self.parse_expr()?);
                if !self.eat(TokenType::Punct, ",") {
                    break;
                }
            }
            let close = self.expect_punct("]")?;
            return Ok(Expr::Array {
                elements,
                span: Span {
                    start: t.start,
                    end: close.end,
                },
            });
        }
        Err(self.fail("Expected an expression."))
    }
}
