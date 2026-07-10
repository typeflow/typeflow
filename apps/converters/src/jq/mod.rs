//! jq → Typeflow converter (port of `src/converter/jq`).

pub mod emit;
pub mod infer;
pub mod parser;

use crate::sample::type_from_sample;
use crate::tf::format::format;
use crate::util::dedupe;
use emit::{emit, emit_object_body, JqCtx};
use infer::infer_input_type;
use parser::{parse_jq, QNode};

pub struct ConvertOutcome {
    pub ok: bool,
    pub typeflow: String,
    pub notes: Vec<String>,
    pub errors: Vec<String>,
}

pub enum InputMode {
    Infer,
    None,
    Sample(serde_json::Value),
}

pub fn convert_jq(source: &str, input_name: &str, input_mode: &InputMode) -> ConvertOutcome {
    let mut notes: Vec<String> = Vec::new();
    let ctx = JqCtx {
        input_name: input_name.to_string(),
        current: input_name.to_string(),
        relative: false,
    };

    let body = (|| -> Result<String, String> {
        let ast = parse_jq(source)?;
        let map_block = match &ast {
            QNode::Object { .. } => format!("map {}", emit_object_body(&ast, &ctx, &mut notes)?),
            _ => format!("map {{ value: {} }}", emit(&ast, &ctx, &mut notes)?),
        };

        if !matches!(ast, QNode::Object { .. }) {
            notes.push(
                "The jq expression is not an object constructor; its value was wrapped in a `value` field."
                    .to_string(),
            );
        }

        let mut parts: Vec<String> = Vec::new();
        match input_mode {
            InputMode::None => {}
            InputMode::Infer => {
                parts.push(format!("input {}: {}", input_name, infer_input_type(&ast)));
                notes.push(
                    "The input type was inferred from the expression - refine the `unknown` leaves."
                        .to_string(),
                );
            }
            InputMode::Sample(sample) => {
                parts.push(format!(
                    "input {}: {}",
                    input_name,
                    type_from_sample(sample)
                ));
            }
        }
        parts.push(map_block);
        Ok(parts.join("\n\n"))
    })();

    let body = match body {
        Ok(b) => b,
        Err(message) => {
            return ConvertOutcome {
                ok: false,
                typeflow: String::new(),
                notes,
                errors: vec![message],
            }
        }
    };

    let formatted = format(&body);
    if !formatted.ok {
        return ConvertOutcome {
            ok: false,
            typeflow: body,
            notes,
            errors: vec![format!(
                "Internal converter error: the generated Typeflow does not parse ({}).",
                formatted.error.unwrap_or_else(|| "unknown".to_string())
            )],
        };
    }
    ConvertOutcome {
        ok: true,
        typeflow: formatted.formatted,
        notes: dedupe(notes),
        errors: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn convert_none(source: &str) -> ConvertOutcome {
        convert_jq(source, "data", &InputMode::None)
    }

    #[test]
    fn object_constructor_with_nested_paths() {
        let out = convert_none("{ id: .id, name: .user.name }");
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  id: data.id,\n  name: data.user.name,\n}\n"
        );
        assert!(out.notes.is_empty());
    }

    #[test]
    fn select_and_member_wraps_non_object_in_value_field() {
        let out = convert_none(".products[] | select(.price > 100) | .name");
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  value: data.products[price > 100].name,\n}\n"
        );
        assert!(out
            .notes
            .iter()
            .any(|n| n.contains("array iteration `.[]`")));
        assert!(out
            .notes
            .iter()
            .any(|n| n.contains("wrapped in a `value` field")));
    }

    #[test]
    fn add_and_length_map_to_sum_and_count() {
        let out = convert_none("{ total: (.items | add), n: (.items | length) }");
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  total: sum(data.items),\n  n: count(data.items),\n}\n"
        );
    }

    #[test]
    fn map_becomes_projection_with_fallback_operator() {
        let out =
            convert_none(r#".users | map({ name: .name, mail: (.contact.email // "none") })"#);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  value: data.users -> { name: name, mail: $.contact?.email ?? \"none\" },\n}\n"
        );
    }

    #[test]
    fn sort_by_becomes_order_by() {
        let out = convert_none(".items | sort_by(.price)");
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(out.typeflow, "map {\n  value: data.items ^(price),\n}\n");
    }

    #[test]
    fn chained_alternative_becomes_optional_chain_and_coalesce() {
        let out = convert_none(r#".a.b.c // "fallback""#);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  value: data.a?.b?.c ?? \"fallback\",\n}\n"
        );
    }

    #[test]
    fn index_and_tostring_and_arithmetic() {
        assert_eq!(
            convert_none(".arr[0]").typeflow,
            "map {\n  value: data.arr[0],\n}\n"
        );
        assert_eq!(
            convert_none(".x | tostring").typeflow,
            "map {\n  value: string(data.x),\n}\n"
        );
        assert_eq!(
            convert_none("1 + 2 * 3").typeflow,
            "map {\n  value: 1 + 2 * 3,\n}\n"
        );
    }

    #[test]
    fn unsupported_parenthesized_pipe_in_boolean_expr_is_rejected() {
        let out = convert_none(".a and .b or (.c | not)");
        assert!(!out.ok);
        assert_eq!(out.typeflow, "");
        assert_eq!(out.errors.len(), 1);
    }

    #[test]
    fn reduce_is_rejected_with_no_declarative_equivalent() {
        let out = convert_none("reduce .[] as $x (0; . + $x)");
        assert!(!out.ok);
        assert!(!out.errors.is_empty());
    }

    #[test]
    fn infer_mode_produces_input_declaration_and_note() {
        let out = convert_jq("{ id: .id }", "data", &InputMode::Infer);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "input data: { id: unknown }\n\nmap {\n  id: data.id,\n}\n"
        );
        assert_eq!(out.notes.len(), 1);
    }

    #[test]
    fn custom_input_name_is_threaded_through() {
        let out = convert_jq("{ id: .id }", "src", &InputMode::Infer);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert!(out.typeflow.starts_with("input src:"));
        assert!(out.typeflow.contains("src.id"));
    }

    #[test]
    fn sample_mode_derives_precise_type_and_emits_no_notes() {
        let sample = serde_json::json!({ "id": 1 });
        let out = convert_jq("{ id: .id }", "data", &InputMode::Sample(sample));
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "input data: { id: number }\n\nmap {\n  id: data.id,\n}\n"
        );
        assert!(out.notes.is_empty());
    }
}
