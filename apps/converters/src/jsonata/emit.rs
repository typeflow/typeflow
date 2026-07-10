//! JSONata AST → Typeflow source emission (port of `src/converter/jsonata/emit.ts`).

use super::parser::JNode;
use crate::util::{is_ident, js_num, json_quote};
use std::collections::{HashMap, HashSet};

/// JSONata stdlib → Typeflow builtin names (same argument order).
fn fn_map(name: &str) -> Option<&'static str> {
    Some(match name {
        "uppercase" => "upper",
        "lowercase" => "lower",
        "trim" => "trim",
        "string" => "string",
        "length" => "length",
        "substring" => "substring",
        "pad" => "pad",
        "contains" => "contains",
        "split" => "split",
        "join" => "join",
        "replace" => "replace",
        "base64encode" => "base64encode",
        "base64decode" => "base64decode",
        "encodeUrl" => "encodeUrl",
        "decodeUrl" => "decodeUrl",
        "encodeUrlComponent" => "encodeUrlComponent",
        "decodeUrlComponent" => "decodeUrlComponent",
        "number" => "number",
        "abs" => "abs",
        "floor" => "floor",
        "ceil" => "ceil",
        "round" => "round",
        "power" => "power",
        "sqrt" => "sqrt",
        "formatBase" => "formatBase",
        "random" => "random",
        "sum" => "sum",
        "max" => "max",
        "min" => "min",
        "average" => "average",
        "boolean" => "boolean",
        "not" => "not",
        "exists" => "exists",
        "count" => "count",
        "append" => "append",
        "sort" => "sort",
        "reverse" => "reverse",
        "distinct" => "distinct",
        "shuffle" => "shuffle",
        "zip" => "zip",
        "keys" => "keys",
        "lookup" => "lookup",
        "merge" => "merge",
        "spread" => "spread",
        "type" => "type",
        "now" => "now",
        "millis" => "millis",
        "fromMillis" => "fromMillis",
        "toMillis" => "toMillis",
        _ => return None,
    })
}

/// Calls whose result is a string — `&` operands from these skip string() wrapping.
const STRING_RESULT_FNS: &[&str] = &[
    "upper",
    "lower",
    "trim",
    "string",
    "substring",
    "pad",
    "replace",
    "join",
    "base64encode",
    "base64decode",
    "encodeUrl",
    "decodeUrl",
    "encodeUrlComponent",
    "decodeUrlComponent",
    "formatBase",
    "now",
    "fromMillis",
];

#[derive(Clone)]
pub struct JCtx {
    /// Name of the Typeflow input binding, prefixed on root-relative paths.
    pub input_name: String,
    /// Inside a predicate/projection, relative names resolve on the element.
    pub relative: bool,
    /// Lambda parameter bound to the element via `$` (filter predicates).
    pub element_param: Option<String>,
    /// Lambda params bound through `->` aliases, emitted verbatim (e.g. `$v`).
    pub bound_params: HashSet<String>,
    /// Block variables inlined by value.
    pub inline_vars: HashMap<String, String>,
    /// Number of enclosing element scopes, for `%` parents.
    pub element_depth: usize,
}

/// Mutable conversion state: unknown `$fn`s → arity (insertion-ordered), notes.
pub struct Conv {
    pub stubs: Vec<(String, usize)>,
    pub notes: Vec<String>,
}

impl Conv {
    fn stub(&mut self, name: &str, arity: usize) {
        if let Some(entry) = self.stubs.iter_mut().find(|(n, _)| n == name) {
            entry.1 = entry.1.max(arity);
        } else {
            self.stubs.push((name.to_string(), arity));
        }
    }
}

/// Enter an element scope (projection body, predicate, sort key).
fn element_scope(ctx: &JCtx) -> JCtx {
    JCtx {
        relative: true,
        element_param: None,
        element_depth: ctx.element_depth + 1,
        ..ctx.clone()
    }
}

fn emits_string(node: &JNode) -> bool {
    match node {
        JNode::Str(_) => true,
        JNode::Binary { op, .. } if op == "&" => true,
        JNode::Call { name, .. } => fn_map(name)
            .map(|mapped| STRING_RESULT_FNS.contains(&mapped))
            .unwrap_or(false),
        _ => false,
    }
}

type EResult = Result<String, String>;

pub fn emit(node: &JNode, ctx: &JCtx, conv: &mut Conv) -> EResult {
    match node {
        JNode::Num(v) => Ok(js_num(*v)),
        JNode::Str(s) => Ok(json_quote(s)),
        JNode::Bool(b) => Ok(b.to_string()),
        JNode::Null => Ok("null".to_string()),

        JNode::Name(value) => {
            // A block variable returning a scalar is inlined by value.
            if let Some(inlined) = ctx.inline_vars.get(value) {
                return Ok(inlined.clone());
            }
            // A lambda param bound through a `->` alias is emitted verbatim.
            if ctx.bound_params.contains(value) {
                return Ok(value.clone());
            }
            if ctx.element_param.as_deref() == Some(value.as_str()) {
                return Ok("$".to_string());
            }
            let name = if is_ident(value) {
                value.clone()
            } else {
                json_quote(value)
            };
            Ok(if ctx.relative {
                name
            } else {
                format!("{}.{}", ctx.input_name, name)
            })
        }

        JNode::Context => Ok(if ctx.relative {
            "$".to_string()
        } else {
            ctx.input_name.clone()
        }),

        // JSONata `$$` is the root document — `$root` reaches the input
        // through any nesting.
        JNode::Root => Ok("$root".to_string()),

        JNode::Parent { depth } => {
            // `$parent` reaches one enclosing element; at or beyond the
            // outermost element is the input (`$root`); strictly-intermediate
            // levels become a `$parent.$parent…` chain.
            let depth = *depth;
            let enclosing = ctx.element_depth;
            if depth <= 1 {
                return Ok("$parent".to_string());
            }
            if depth >= enclosing {
                return Ok("$root".to_string());
            }
            Ok(vec!["$parent"; depth].join("."))
        }

        JNode::Dot { left, right } => {
            // `arr.{ ... }` and `arr.( ...; { ... } )` — per-element projection.
            let is_projection = matches!(right.as_ref(), JNode::Object { .. })
                || matches!(right.as_ref(), JNode::Block { result, .. } if matches!(result.as_ref(), JNode::Object { .. }));
            if is_projection {
                // A `#$i` positional binding on the source becomes an index binder.
                let source = match left.as_ref() {
                    JNode::Bind {
                        target,
                        variable,
                        op: '#',
                    } => Some((target.as_ref(), variable.clone())),
                    _ => None,
                };
                let mut body_ctx = element_scope(ctx);
                if let Some((_, variable)) = &source {
                    body_ctx.bound_params.insert(variable.clone());
                }
                let body = emit(right, &body_ctx, conv)?;
                let arrow = match &source {
                    Some((_, variable)) => format!("-> _, {} ", variable),
                    None => "-> ".to_string(),
                };
                let target = match &source {
                    Some((target, _)) => emit(target, ctx, conv)?,
                    None => emit(left, ctx, conv)?,
                };
                return Ok(format!("({}) {}{}", target, arrow, body));
            }
            if let JNode::Name(right_name) = right.as_ref() {
                let base = match left.as_ref() {
                    JNode::Name(left_name)
                        if ctx.element_param.as_deref() == Some(left_name.as_str()) =>
                    {
                        "$".to_string()
                    }
                    _ => emit(left, ctx, conv)?,
                };
                // `$v.field` reads on the element: bare identifier in typeflow.
                if base == "$" {
                    return Ok(right_name.clone());
                }
                return Ok(format!("{}.{}", base, right_name));
            }
            Err("Unsupported path step.".to_string())
        }

        JNode::Predicate { target, expr } => {
            let target_text = emit(target, ctx, conv)?;
            let inner = emit(expr, &element_scope(ctx), conv)?;
            Ok(format!("{}[{}]", target_text, inner))
        }

        JNode::Sort { target, terms } => {
            let target_text = emit(target, ctx, conv)?;
            let mut term_texts: Vec<String> = Vec::new();
            for (key, descending) in terms {
                let inner = emit(key, &element_scope(ctx), conv)?;
                term_texts.push(format!("{}{}", if *descending { ">" } else { "" }, inner));
            }
            Ok(format!("{} ^({})", target_text, term_texts.join(", ")))
        }

        JNode::Block { .. } => emit_block(node, ctx, conv),

        JNode::Call { name, args } => emit_call(name, args, ctx, conv),

        JNode::Lambda { .. } => {
            Err("Lambdas are only supported as $map/$filter arguments.".to_string())
        }

        JNode::Bind { .. } => Err("@/# binds are not supported — reshape explicitly.".to_string()),

        JNode::Binary { op, left, right } => emit_binary(op, left, right, ctx, conv),

        JNode::Ternary { cond, then, els } => Ok(format!(
            "({} ? {} : {})",
            emit(cond, ctx, conv)?,
            emit(then, ctx, conv)?,
            emit(els, ctx, conv)?
        )),

        JNode::Object { .. } => emit_object_body(node, ctx, conv),

        JNode::Array { items } => {
            let parts = items
                .iter()
                .map(|item| emit(item, ctx, conv))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("[{}]", parts.join(", ")))
        }

        JNode::Neg { operand } => Ok(format!("-({})", emit(operand, ctx, conv)?)),
    }
}

pub fn emit_object_body(node: &JNode, ctx: &JCtx, conv: &mut Conv) -> EResult {
    let JNode::Object { pairs } = node else {
        unreachable!("emit_object_body requires an object node");
    };
    let mut props: Vec<String> = Vec::new();
    for (key, value) in pairs {
        let name = if is_ident(key) {
            key.clone()
        } else {
            json_quote(key)
        };
        props.push(format!("{}: {}", name, emit(value, ctx, conv)?));
    }
    Ok(format!("{{ {} }}", props.join(", ")))
}

fn emit_block(node: &JNode, ctx: &JCtx, conv: &mut Conv) -> EResult {
    let JNode::Block { bindings, result } = node else {
        unreachable!("emit_block requires a block node");
    };
    // When the block returns an object constructor, the bindings become
    // Typeflow `let`s; otherwise the variables are inlined by value.
    if let JNode::Object { pairs } = result.as_ref() {
        let mut bound = ctx.bound_params.clone();
        let mut lets: Vec<String> = Vec::new();
        for (name, value) in bindings {
            let let_ctx = JCtx {
                bound_params: bound.clone(),
                ..ctx.clone()
            };
            lets.push(format!("let {} = {}", name, emit(value, &let_ctx, conv)?));
            bound.insert(name.clone());
        }
        let prop_ctx = JCtx {
            bound_params: bound,
            ..ctx.clone()
        };
        let mut parts = lets;
        for (key, value) in pairs {
            let prop_name = if is_ident(key) {
                key.clone()
            } else {
                json_quote(key)
            };
            parts.push(format!("{}: {}", prop_name, emit(value, &prop_ctx, conv)?));
        }
        return Ok(format!("{{ {} }}", parts.join(", ")));
    }

    let mut inline_vars = ctx.inline_vars.clone();
    for (name, value) in bindings {
        let value_ctx = JCtx {
            inline_vars: inline_vars.clone(),
            ..ctx.clone()
        };
        let text = emit(value, &value_ctx, conv)?;
        inline_vars.insert(name.clone(), format!("({})", text));
    }
    let result_ctx = JCtx {
        inline_vars,
        ..ctx.clone()
    };
    emit(result, &result_ctx, conv)
}

fn emit_call(name: &str, args: &[JNode], ctx: &JCtx, conv: &mut Conv) -> EResult {
    // Higher-order JSONata functions map onto language constructs.
    if name == "filter" && args.len() == 2 {
        if let JNode::Lambda { params, body } = &args[1] {
            if params.len() == 1 {
                let mut inner_ctx = element_scope(ctx);
                inner_ctx.element_param = Some(params[0].clone());
                let inner = emit(body, &inner_ctx, conv)?;
                return Ok(format!("{}[{}]", emit(&args[0], ctx, conv)?, inner));
            }
        }
    }
    if name == "map" && args.len() == 2 {
        if let JNode::Lambda { params, body } = &args[1] {
            if params.len() == 1 {
                if let JNode::Object { .. } = body.as_ref() {
                    // The lambda param becomes a `->` alias, so nested `$map`s
                    // keep access to the outer element.
                    let param = params[0].clone();
                    let mut body_ctx = element_scope(ctx);
                    body_ctx.bound_params.insert(param.clone());
                    let body_text = emit_object_body(body, &body_ctx, conv)?;
                    return Ok(format!(
                        "({}) -> {} {}",
                        emit(&args[0], ctx, conv)?,
                        param,
                        body_text
                    ));
                }
            }
        }
        return Err(
            "$map is only supported with a single-parameter lambda returning an object — use `->` projection."
                .to_string(),
        );
    }
    if name == "substringBefore" && args.len() == 2 {
        conv.notes.push(
            "$substringBefore was converted to a split()[0] idiom; behavior differs when the separator is absent."
                .to_string(),
        );
        return Ok(format!(
            "(split({}, {})[0] ?? \"\")",
            emit(&args[0], ctx, conv)?,
            emit(&args[1], ctx, conv)?
        ));
    }
    if name == "substringAfter" && args.len() == 2 {
        conv.notes.push(
            "$substringAfter was converted to a split()[1] idiom; behavior differs when the separator is absent."
                .to_string(),
        );
        return Ok(format!(
            "(split({}, {})[1] ?? \"\")",
            emit(&args[0], ctx, conv)?,
            emit(&args[1], ctx, conv)?
        ));
    }

    match fn_map(name) {
        None => {
            // No stdlib equivalent: emit a stub `fn` mock so the output still
            // compiles.
            let arity = args.len();
            conv.stub(name, arity);
            conv.notes.push(format!(
                "${} has no Typeflow equivalent — a stub `fn {}` was generated; implement it or replace it with a `use`/`defineFunction`.",
                name, name
            ));
            let stub_args = args
                .iter()
                .map(|a| emit(a, ctx, conv))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("{}({})", name, stub_args.join(", ")))
        }
        Some(mapped) => {
            let arg_texts = args
                .iter()
                .map(|a| emit(a, ctx, conv))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("{}({})", mapped, arg_texts.join(", ")))
        }
    }
}

/// A mock `fn` declaration for an unknown JSONata function: params in, first arg out.
pub fn stub_fn(name: &str, arity: usize) -> String {
    let params = (0..arity)
        .map(|i| format!("a{}: unknown", i))
        .collect::<Vec<_>>()
        .join(", ");
    let body_expr = if arity > 0 { "a0" } else { "null" };
    format!("fn {}({}): unknown = {}", name, params, body_expr)
}

fn emit_binary(op: &str, left: &JNode, right: &JNode, ctx: &JCtx, conv: &mut Conv) -> EResult {
    if op == "&" {
        let left_text = if emits_string(left) {
            emit(left, ctx, conv)?
        } else {
            format!("string({})", emit(left, ctx, conv)?)
        };
        let right_text = if emits_string(right) {
            emit(right, ctx, conv)?
        } else {
            format!("string({})", emit(right, ctx, conv)?)
        };
        return Ok(format!("({} + {})", left_text, right_text));
    }
    if op == "in" {
        // `v in list` → membership via a filtered count.
        conv.notes.push(
            "`in` was rewritten to `count(list[$ == value]) > 0`; if the tested value is a bare field of an enclosing `->` element, alias that element so the comparison reads the right scope."
                .to_string(),
        );
        return Ok(format!(
            "(count({}[$ == {}]) > 0)",
            emit(right, ctx, conv)?,
            emit(left, ctx, conv)?
        ));
    }
    let mapped = match op {
        "=" => "==",
        "!=" => "!=",
        "<" => "<",
        "<=" => "<=",
        ">" => ">",
        ">=" => ">=",
        "+" => "+",
        "-" => "-",
        "*" => "*",
        "/" => "/",
        "%" => "%",
        "and" => "&&",
        "or" => "||",
        _ => return Err(format!("Unsupported operator '{}'.", op)),
    };
    Ok(format!(
        "({} {} {})",
        emit(left, ctx, conv)?,
        mapped,
        emit(right, ctx, conv)?
    ))
}
