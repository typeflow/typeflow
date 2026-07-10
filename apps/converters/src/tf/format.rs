//! Canonical formatter (port of `src/formatter/index.ts`). Produces the same
//! bytes as the TypeScript printer: same inline-width rule (70 columns,
//! measured in UTF-16 units like JS `String.length`), same comment and
//! blank-line preservation.

use super::ast::*;
use super::lexer::{tokenize, Token, TokenType, TokenizeOptions};
use super::parser::parse;
use crate::util::{js_num, json_quote, prop_name};

pub struct FormatResult {
    pub ok: bool,
    pub formatted: String,
    /// First diagnostic message when the source does not parse.
    pub error: Option<String>,
}

const INLINE_LIMIT: usize = 70;

/// JS `String.length` (UTF-16 code units).
fn utf16_len(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16()).sum()
}

pub fn format(source: &str) -> FormatResult {
    let outcome = parse(source);
    let Some(ast) = outcome.ast else {
        return FormatResult {
            ok: false,
            formatted: source.to_string(),
            error: outcome.error,
        };
    };
    let comments = tokenize(
        source,
        &TokenizeOptions {
            include_comments: true,
            tolerant: true,
        },
    )
    .map(|tokens| {
        tokens
            .into_iter()
            .filter(|t| t.type_ == TokenType::Comment)
            .collect::<Vec<_>>()
    })
    .unwrap_or_default();
    let mut printer = Printer {
        source,
        comments,
        next_comment: 0,
    };
    FormatResult {
        ok: true,
        formatted: printer.print(&ast),
        error: None,
    }
}

fn binary_prec(op: &str) -> usize {
    match op {
        "??" => 2,
        "||" => 3,
        "&&" => 4,
        "==" | "!=" => 5,
        "<" | "<=" | ">" | ">=" => 6,
        "+" | "-" => 7,
        "*" | "/" | "%" => 8,
        _ => unreachable!("unknown binary operator"),
    }
}

fn prec_of(e: &Expr) -> usize {
    match e {
        Expr::Cond { .. } => 1,
        Expr::Binary { op, .. } => binary_prec(op),
        Expr::Unary { .. } => 9,
        Expr::Member { .. } | Expr::Bracket { .. } | Expr::Sort { .. } | Expr::Project { .. } => 10,
        _ => 11,
    }
}

struct Printer<'a> {
    source: &'a str,
    comments: Vec<Token>,
    next_comment: usize,
}

impl<'a> Printer<'a> {
    fn print(&mut self, ast: &MappingFile) -> String {
        let mut lines: Vec<String> = Vec::new();
        let mut prev_end = 0usize;

        if let Some(input) = &ast.input {
            self.emit_comments(&mut lines, input.span.start, prev_end, "");
            let rhs = match (&input.type_ref, &input.inline_type) {
                (Some((type_name, from)), _) => {
                    format!("{} from {}", type_name, json_quote(from))
                }
                (None, Some(inline)) => self.print_type(inline, 0),
                _ => unreachable!(),
            };
            lines.push(format!("input {}: {}", input.name, rhs));
            prev_end = input.span.end;
        }

        if !ast.uses.is_empty() {
            if ast.input.is_some() {
                lines.push(String::new());
            }
            for u in &ast.uses {
                self.emit_comments(&mut lines, u.span.start, prev_end, "");
                lines.push(format!(
                    "use {}({}): {} from {}",
                    u.name,
                    self.print_params(&u.params),
                    self.print_type(&u.return_type, 0),
                    json_quote(&u.from)
                ));
                prev_end = u.span.end;
            }
        }

        if !ast.fns.is_empty() {
            if ast.input.is_some() || !ast.uses.is_empty() {
                lines.push(String::new());
            }
            for f in &ast.fns {
                self.emit_comments(&mut lines, f.span.start, prev_end, "");
                let ret = match &f.return_type {
                    Some(t) => format!(": {}", self.print_type(t, 0)),
                    None => String::new(),
                };
                lines.push(format!(
                    "fn {}({}){} = {}",
                    f.name,
                    self.print_params(&f.params),
                    ret,
                    self.print_expr(&f.body, 1, 0)
                ));
                prev_end = f.span.end;
            }
        }

        if ast.input.is_some() || !ast.uses.is_empty() || !ast.fns.is_empty() {
            lines.push(String::new());
        }

        self.emit_comments(&mut lines, ast.map.span.start, prev_end, "");
        let map_text = self.print_object(&ast.map, 0, true);
        lines.push(format!("map {}", map_text));
        prev_end = ast.map.span.end;

        self.emit_comments(&mut lines, self.source.len(), prev_end, "");

        let mut out = collapse_blanks(lines).join("\n");
        out.push('\n');
        out
    }

    // ---- comments & layout ----

    fn has_blank_between(&self, from: usize, to: usize) -> bool {
        // /\n[ \t]*\r?\n/ on the slice
        let slice = &self.source.as_bytes()[from.min(self.source.len())..to.min(self.source.len())];
        let mut i = 0;
        while i < slice.len() {
            if slice[i] == b'\n' {
                let mut j = i + 1;
                while j < slice.len() && (slice[j] == b' ' || slice[j] == b'\t') {
                    j += 1;
                }
                if j < slice.len() && slice[j] == b'\r' {
                    j += 1;
                }
                if j < slice.len() && slice[j] == b'\n' {
                    return true;
                }
            }
            i += 1;
        }
        false
    }

    fn emit_comments(
        &mut self,
        lines: &mut Vec<String>,
        offset: usize,
        mut prev_end: usize,
        pad: &str,
    ) -> usize {
        while self.next_comment < self.comments.len()
            && self.comments[self.next_comment].start < offset
        {
            let c = self.comments[self.next_comment].clone();
            self.next_comment += 1;
            if self.has_blank_between(prev_end, c.start) {
                lines.push(String::new());
            }
            lines.push(format!("{}{}", pad, c.value.trim_end()));
            prev_end = c.end;
        }
        prev_end
    }

    fn has_comment_within(&self, start: usize, end: usize) -> bool {
        for i in self.next_comment..self.comments.len() {
            let c = &self.comments[i];
            if c.start >= end {
                return false;
            }
            if c.start > start {
                return true;
            }
        }
        false
    }

    // ---- expressions ----

    fn print_params(&mut self, params: &[UseParam]) -> String {
        params
            .iter()
            .map(|p| {
                format!(
                    "{}{}: {}",
                    p.name,
                    if p.optional { "?" } else { "" },
                    self.print_type(&p.type_, 0)
                )
            })
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn print_object(&mut self, obj: &ObjectExpr, indent: usize, force_multiline: bool) -> String {
        // Merge `let` bindings and properties back into source order.
        enum Member<'m> {
            Let(&'m LetBinding),
            Prop(&'m ObjectProp),
        }
        let mut members: Vec<(Span, Member)> = Vec::new();
        for l in &obj.lets {
            members.push((l.span, Member::Let(l)));
        }
        for p in &obj.props {
            members.push((p.span, Member::Prop(p)));
        }
        members.sort_by_key(|(span, _)| span.start); // stable, like toSorted

        if members.is_empty() {
            return "{}".to_string();
        }

        let member_text = |printer: &mut Self, member: &Member, i: usize| -> String {
            match member {
                Member::Let(l) => {
                    format!("let {} = {}", l.name, printer.print_expr(&l.value, 1, i))
                }
                Member::Prop(p) => format!(
                    "{}: {}",
                    prop_name(&p.name),
                    printer.print_expr(&p.value, 1, i)
                ),
            }
        };

        if !force_multiline && !self.has_comment_within(obj.span.start, obj.span.end) {
            let parts: Vec<String> = members
                .iter()
                .map(|(_, m)| member_text(self, m, indent))
                .collect();
            let inline = format!("{{ {} }}", parts.join(", "));
            if !inline.contains('\n') && indent + utf16_len(&inline) <= INLINE_LIMIT {
                return inline;
            }
        }

        let pad = " ".repeat(indent + 2);
        let mut lines: Vec<String> = vec!["{".to_string()];
        let mut prev_end = obj.span.start + 1;
        for (span, member) in &members {
            let before = lines.len();
            prev_end = self.emit_comments(&mut lines, span.start, prev_end, &pad);
            if lines.len() == before && self.has_blank_between(prev_end, span.start) {
                lines.push(String::new());
            }
            let text = member_text(self, member, indent + 2);
            lines.push(format!("{}{},", pad, text));
            prev_end = span.end;
        }
        self.emit_comments(&mut lines, obj.span.end, prev_end, &pad);
        lines.push(format!("{}}}", " ".repeat(indent)));
        lines.join("\n")
    }

    fn print_expr(&mut self, e: &Expr, min_prec: usize, indent: usize) -> String {
        let text = self.print_expr_inner(e, indent);
        if prec_of(e) < min_prec {
            format!("({})", text)
        } else {
            text
        }
    }

    fn print_expr_inner(&mut self, e: &Expr, indent: usize) -> String {
        match e {
            Expr::Lit { value, .. } => match value {
                LitValue::Null => "null".to_string(),
                LitValue::Str(s) => json_quote(s),
                LitValue::Num(n) => js_num(*n),
                LitValue::Bool(b) => b.to_string(),
            },
            Expr::Ident { name, .. } => name.clone(),
            Expr::Member {
                object,
                name,
                optional,
                ..
            } => format!(
                "{}{}{}",
                self.print_expr(object, 10, indent),
                if *optional { "?." } else { "." },
                name
            ),
            Expr::Bracket { object, inner, .. } => format!(
                "{}[{}]",
                self.print_expr(object, 10, indent),
                self.print_expr(inner, 1, indent)
            ),
            Expr::Sort { object, terms, .. } => {
                let object_text = self.print_expr(object, 10, indent);
                let terms_text = terms
                    .iter()
                    .map(|t| {
                        format!(
                            "{}{}",
                            if t.descending { ">" } else { "" },
                            self.print_expr(&t.key, 1, indent)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{} ^({})", object_text, terms_text)
            }
            Expr::Project {
                object,
                binder,
                index_binder,
                body,
                ..
            } => {
                let binders = match binder {
                    Some(b) => match index_binder {
                        Some(i) => format!("{}, {} ", b, i),
                        None => format!("{} ", b),
                    },
                    None => String::new(),
                };
                let object_text = self.print_expr(object, 10, indent);
                let body_text = self.print_object(body, indent, false);
                format!("{} -> {}{}", object_text, binders, body_text)
            }
            Expr::Unary { op, operand, .. } => {
                let operand_text = self.print_expr(operand, 9, indent);
                // Avoid `--x` fusing into an invalid token sequence visually.
                let sep = if *op == '-' && operand_text.starts_with('-') {
                    " "
                } else {
                    ""
                };
                format!("{}{}{}", op, sep, operand_text)
            }
            Expr::Binary {
                op, left, right, ..
            } => {
                let prec = binary_prec(op);
                format!(
                    "{} {} {}",
                    self.print_expr(left, prec, indent),
                    op,
                    self.print_expr(right, prec + 1, indent)
                )
            }
            Expr::Cond {
                cond, then, els, ..
            } => format!(
                "{} ? {} : {}",
                self.print_expr(cond, 2, indent),
                self.print_expr(then, 1, indent),
                self.print_expr(els, 1, indent)
            ),
            Expr::Call { name, args, .. } => {
                let args_text = args
                    .iter()
                    .map(|a| self.print_expr(a, 1, indent))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{}({})", name, args_text)
            }
            Expr::Object(obj) => self.print_object(obj, indent, false),
            Expr::Array { elements, .. } => {
                let parts: Vec<String> = elements
                    .iter()
                    .map(|el| self.print_expr(el, 1, indent + 2))
                    .collect();
                let inline = format!("[{}]", parts.join(", "));
                if !inline.contains('\n') && indent + utf16_len(&inline) <= INLINE_LIMIT {
                    return inline;
                }
                let pad = " ".repeat(indent + 2);
                format!(
                    "[\n{}\n{}]",
                    parts
                        .iter()
                        .map(|p| format!("{}{},", pad, p))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    " ".repeat(indent)
                )
            }
        }
    }

    // ---- inline types ----

    fn print_type(&mut self, node: &TypeNode, indent: usize) -> String {
        match node {
            TypeNode::Prim { name, .. } => name.clone(),
            TypeNode::Lit { value, .. } => match value {
                LitValue::Str(s) => json_quote(s),
                LitValue::Num(n) => js_num(*n),
                LitValue::Bool(b) => b.to_string(),
                LitValue::Null => "null".to_string(),
            },
            TypeNode::Array { element, .. } => {
                let el = self.print_type(element, indent);
                if matches!(element.as_ref(), TypeNode::Union { .. }) {
                    format!("({})[]", el)
                } else {
                    format!("{}[]", el)
                }
            }
            TypeNode::Union { types, .. } => types
                .iter()
                .map(|t| self.print_type(t, indent))
                .collect::<Vec<_>>()
                .join(" | "),
            TypeNode::Object { fields, span } => {
                if fields.is_empty() {
                    return "{}".to_string();
                }
                let parts: Vec<String> = fields
                    .iter()
                    .map(|f| {
                        format!(
                            "{}{}: {}",
                            prop_name(&f.name),
                            if f.optional { "?" } else { "" },
                            self.print_type(&f.type_, indent)
                        )
                    })
                    .collect();
                let inline = format!("{{ {} }}", parts.join(", "));
                if !inline.contains('\n')
                    && indent + utf16_len(&inline) <= INLINE_LIMIT
                    && !self.has_comment_within(span.start, span.end)
                {
                    return inline;
                }
                let pad = " ".repeat(indent + 2);
                let mut lines: Vec<String> = vec!["{".to_string()];
                let mut prev_end = span.start + 1;
                for field in fields {
                    self.emit_comments(&mut lines, field.span.start, prev_end, &pad);
                    lines.push(format!(
                        "{}{}{}: {},",
                        pad,
                        prop_name(&field.name),
                        if field.optional { "?" } else { "" },
                        self.print_type(&field.type_, indent + 2)
                    ));
                    prev_end = field.span.end;
                }
                self.emit_comments(&mut lines, span.end, prev_end, &pad);
                lines.push(format!("{}}}", " ".repeat(indent)));
                lines.join("\n")
            }
        }
    }
}

/// Collapse runs of blank lines to one and trim leading/trailing blanks.
fn collapse_blanks(lines: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in lines {
        if line.is_empty() && (out.is_empty() || out.last().is_some_and(|l| l.is_empty())) {
            continue;
        }
        out.push(line);
    }
    while out.last().is_some_and(|l| l.is_empty()) {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn already_canonical_source_round_trips_unchanged() {
        let src = "input u: { name: string, tags: string[] }\n\nmap {\n  n: u.name,\n  c: count(u.tags),\n}\n";
        let out = format(src);
        assert!(out.ok);
        assert_eq!(out.formatted, src);
        assert!(out.error.is_none());
    }

    #[test]
    fn collapses_whitespace_and_multilines_the_object() {
        let out = format("map{x:1,y:2}");
        assert!(out.ok);
        assert_eq!(out.formatted, "map {\n  x: 1,\n  y: 2,\n}\n");
    }

    #[test]
    fn invalid_source_is_returned_unchanged_with_a_diagnostic() {
        let src = "map { x: ) }";
        let out = format(src);
        assert!(!out.ok);
        assert_eq!(out.formatted, src);
        assert_eq!(out.error.as_deref(), Some("Expected an expression."));
    }
}
