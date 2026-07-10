//! jq AST → Typeflow source emission (port of `src/converter/jq/emit.ts`).

use super::parser::{QNode, UnaryOp};
use crate::util::{is_ident, js_num, json_quote};

fn fn_map(name: &str) -> Option<&'static str> {
    Some(match name {
        "length" => "count",
        "tostring" => "string",
        "tonumber" => "number",
        "floor" => "floor",
        "ceil" => "ceil",
        "round" => "round",
        "sqrt" => "sqrt",
        "keys" => "keys",
        "reverse" => "reverse",
        "unique" => "distinct",
        "join" => "join",
        "split" => "split",
        "contains" => "contains",
        "ascii_upcase" => "upper",
        "ascii_downcase" => "lower",
        _ => return None,
    })
}

#[derive(Clone)]
pub struct JqCtx {
    pub input_name: String,
    pub current: String,
    /// Kept for parity with the TS EmitContext; jq emission only reads
    /// `current` (unlike JSONata, where `relative` drives name resolution).
    #[allow(dead_code)]
    pub relative: bool,
}

fn field_name(value: &str) -> String {
    if is_ident(value) {
        value.to_string()
    } else {
        json_quote(value)
    }
}

fn element_scope(ctx: &JqCtx) -> JqCtx {
    JqCtx {
        input_name: ctx.input_name.clone(),
        current: "$".to_string(),
        relative: true,
    }
}

fn root_scope(ctx: &JqCtx, current: String) -> JqCtx {
    JqCtx {
        input_name: ctx.input_name.clone(),
        current,
        relative: false,
    }
}

type EResult = Result<String, String>;

pub fn emit(node: &QNode, ctx: &JqCtx, notes: &mut Vec<String>) -> EResult {
    match node {
        QNode::Num(v) => Ok(js_num(*v)),
        QNode::Str(s) => Ok(json_quote(s)),
        QNode::Bool(b) => Ok(b.to_string()),
        QNode::Null => Ok("null".to_string()),
        QNode::Input => Ok(ctx.current.clone()),
        QNode::Field { target, name } => {
            let base = emit(target, ctx, notes)?;
            let name = field_name(name);
            if base == "$" {
                Ok(name)
            } else {
                Ok(format!("{}.{}", base, name))
            }
        }
        QNode::Index { target, index } => Ok(format!(
            "{}[{}]",
            emit(target, ctx, notes)?,
            emit(index, ctx, notes)?
        )),
        QNode::Iterate { target } => {
            notes.push(
                "jq array iteration `.[]` was converted to the array value itself.".to_string(),
            );
            emit(target, ctx, notes)
        }
        QNode::Pipe { left, right } => emit_pipe(left, right, ctx, notes),
        QNode::Call { name, args } => emit_call(name, args, ctx, notes),
        QNode::Binary { op, left, right } => emit_binary(op, left, right, ctx, notes),
        QNode::Unary { op, expr } => {
            let inner = emit(expr, ctx, notes)?;
            Ok(match op {
                UnaryOp::Not => format!("!({})", inner),
                UnaryOp::Neg => format!("-({})", inner),
            })
        }
        QNode::Object { .. } => emit_object_body(node, ctx, notes),
        QNode::Array { items } => {
            let parts = items
                .iter()
                .map(|item| emit(item, ctx, notes))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("[{}]", parts.join(", ")))
        }
    }
}

pub fn emit_object_body(node: &QNode, ctx: &JqCtx, notes: &mut Vec<String>) -> EResult {
    let QNode::Object { pairs } = node else {
        unreachable!("emit_object_body requires an object node");
    };
    let mut props: Vec<String> = Vec::new();
    for (key, value) in pairs {
        props.push(format!("{}: {}", field_name(key), emit(value, ctx, notes)?));
    }
    Ok(format!("{{ {} }}", props.join(", ")))
}

fn emit_pipe(left: &QNode, right: &QNode, ctx: &JqCtx, notes: &mut Vec<String>) -> EResult {
    let left_text = emit(left, ctx, notes)?;
    if matches!(right, QNode::Object { .. }) {
        let body = emit_object_body(right, &element_scope(ctx), notes)?;
        return Ok(format!("({}) -> {}", left_text, body));
    }
    emit(right, &root_scope(ctx, left_text), notes)
}

fn emit_call(name: &str, args: &[QNode], ctx: &JqCtx, notes: &mut Vec<String>) -> EResult {
    if name == "select" && args.len() == 1 {
        let predicate = emit(&args[0], &element_scope(ctx), notes)?;
        return Ok(format!("{}[{}]", ctx.current, predicate));
    }
    if name == "map" && args.len() == 1 {
        let body = emit(&args[0], &element_scope(ctx), notes)?;
        return Ok(format!("({}) -> {}", ctx.current, body));
    }
    if name == "sort_by" && args.len() == 1 {
        let key = emit(&args[0], &element_scope(ctx), notes)?;
        return Ok(format!("{} ^({})", ctx.current, key));
    }
    if name == "add" && args.is_empty() {
        return Ok(format!("sum({})", ctx.current));
    }

    let Some(mapped) = fn_map(name) else {
        return Err(format!("Unsupported jq function '{}'.", name));
    };
    let arg_texts = if args.is_empty() {
        vec![ctx.current.clone()]
    } else {
        args.iter()
            .map(|arg| emit(arg, ctx, notes))
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(format!("{}({})", mapped, arg_texts.join(", ")))
}

fn emit_binary(
    op: &str,
    left: &QNode,
    right: &QNode,
    ctx: &JqCtx,
    notes: &mut Vec<String>,
) -> EResult {
    let mapped = match op {
        "//" => "??",
        "==" => "==",
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
        _ => return Err(format!("Unsupported jq operator '{}'.", op)),
    };
    if op == "//" {
        return Ok(format!(
            "({} ?? {})",
            emit_optional(left, ctx, notes)?,
            emit(right, ctx, notes)?
        ));
    }
    Ok(format!(
        "({} {} {})",
        emit(left, ctx, notes)?,
        mapped,
        emit(right, ctx, notes)?
    ))
}

fn emit_optional(node: &QNode, ctx: &JqCtx, notes: &mut Vec<String>) -> EResult {
    if !matches!(node, QNode::Field { .. }) {
        return emit(node, ctx, notes);
    }
    let mut parts: Vec<String> = Vec::new();
    let mut current = node;
    while let QNode::Field { target, name } = current {
        parts.insert(0, field_name(name));
        current = target;
    }
    let base = emit(current, ctx, notes)?;
    if parts.is_empty() {
        return Ok(base);
    }
    Ok(format!("{}.{}", base, parts.join("?.")))
}
