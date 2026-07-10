//! JSONata → Typeflow converter (port of `src/converter/jsonata`).

pub mod emit;
pub mod infer;
pub mod parser;

use crate::jq::{ConvertOutcome, InputMode};
use crate::sample::type_from_sample;
use crate::tf::format::format;
use crate::util::dedupe;
use emit::{emit, emit_object_body, stub_fn, Conv, JCtx};
use infer::infer_input_type;
use parser::{parse_jsonata, JNode};
use std::collections::{HashMap, HashSet};

pub fn convert_jsonata(source: &str, input_name: &str, input_mode: &InputMode) -> ConvertOutcome {
    let mut conv = Conv {
        stubs: Vec::new(),
        notes: Vec::new(),
    };
    let ctx = JCtx {
        input_name: input_name.to_string(),
        relative: false,
        element_param: None,
        bound_params: HashSet::new(),
        inline_vars: HashMap::new(),
        element_depth: 0,
    };

    let body = (|conv: &mut Conv| -> Result<String, String> {
        let ast = parse_jsonata(source)?;
        // Emit the map first: this populates the stubs with unknown functions.
        let map_block = if matches!(ast, JNode::Object { .. }) {
            format!("map {}", emit_object_body(&ast, &ctx, conv)?)
        } else if matches!(&ast, JNode::Block { result, .. } if matches!(result.as_ref(), JNode::Object { .. }))
        {
            // `( $x := ...; { ... } )` becomes a `map` block with `let` bindings.
            format!("map {}", emit(&ast, &ctx, conv)?)
        } else {
            conv.notes.push(
                "The JSONata expression is not an object constructor; its value was wrapped in a `value` field."
                    .to_string(),
            );
            format!("map {{ value: {} }}", emit(&ast, &ctx, conv)?)
        };
        // Assemble: input declaration, then stub `fn` mocks, then the map block.
        let mut parts: Vec<String> = Vec::new();
        match input_mode {
            InputMode::None => {}
            InputMode::Infer => {
                parts.push(format!("input {}: {}", input_name, infer_input_type(&ast)));
                conv.notes.push(
                    "The input type was inferred from the expression — refine the `unknown` leaves."
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
        for (name, arity) in &conv.stubs {
            parts.push(stub_fn(name, *arity));
        }
        parts.push(map_block);
        Ok(parts.join("\n\n"))
    })(&mut conv);

    let body = match body {
        Ok(b) => b,
        Err(message) => {
            return ConvertOutcome {
                ok: false,
                typeflow: String::new(),
                notes: conv.notes,
                errors: vec![message],
            }
        }
    };

    let formatted = format(&body);
    if !formatted.ok {
        return ConvertOutcome {
            ok: false,
            typeflow: body,
            notes: conv.notes,
            errors: vec![format!(
                "Internal converter error: the generated Typeflow does not parse ({}).",
                formatted.error.unwrap_or_else(|| "unknown".to_string())
            )],
        };
    }
    ConvertOutcome {
        ok: true,
        typeflow: formatted.formatted,
        notes: dedupe(conv.notes),
        errors: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn convert_none(source: &str) -> ConvertOutcome {
        convert_jsonata(source, "data", &InputMode::None)
    }

    #[test]
    fn string_concat_and_member_access() {
        let out =
            convert_none(r#"{ "fullName": firstName & " " & lastName, "city": address.city }"#);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  fullName: string(data.firstName) + \" \" + string(data.lastName),\n  city: data.address.city,\n}\n"
        );
        assert!(out.notes.is_empty());
    }

    #[test]
    fn predicate_filter_with_per_element_object_constructor() {
        let out = convert_none(r#"{ "adults": people[age >= 18].{ "n": name } }"#);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  adults: data.people[age >= 18] -> { n: name },\n}\n"
        );
    }

    #[test]
    fn dollar_stdlib_function_maps_to_bare_name() {
        let out = convert_none("$sum(items.price)");
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(out.typeflow, "map {\n  value: sum(data.items.price),\n}\n");
        assert!(out
            .notes
            .iter()
            .any(|n| n.contains("wrapped in a `value` field")));
    }

    #[test]
    fn order_by_preserves_descending_marker() {
        let out = convert_none("orders^(>total, name)");
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  value: data.orders ^(>total, name),\n}\n"
        );
    }

    #[test]
    fn membership_in_becomes_count_comparison() {
        let out = convert_none(r#"{ "in": code in allowed }"#);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  in: count(data.allowed[$ == data.code]) > 0,\n}\n"
        );
        assert_eq!(out.notes.len(), 1);
    }

    #[test]
    fn unary_minus_and_ternary() {
        let out = convert_none(r#"{ "neg": -value, "t": cond ? "y" : "n" }"#);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  neg: -data.value,\n  t: data.cond ? \"y\" : \"n\",\n}\n"
        );
    }

    #[test]
    fn plain_path_and_empty_object() {
        assert_eq!(
            convert_none("a.b.c.d").typeflow,
            "map {\n  value: data.a.b.c.d,\n}\n"
        );
        let empty = convert_none("{}");
        assert!(empty.ok);
        assert_eq!(empty.typeflow, "map {}\n");
    }

    #[test]
    fn map_lambda_becomes_projection() {
        let out = convert_none(r#"{ "m": $map(items, function($v) { { "n": $v.name } }) }"#);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "map {\n  m: data.items -> $v { n: $v.name },\n}\n"
        );
    }

    #[test]
    fn filter_lambda_becomes_predicate() {
        let out = convert_none(r#"{ "f": $filter(items, function($v) { $v.price > 10 }) }"#);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(out.typeflow, "map {\n  f: data.items[price > 10],\n}\n");
    }

    #[test]
    fn reduce_is_rejected_and_stubbed() {
        let out = convert_none("$reduce(items, function($acc, $x) { $acc + $x })");
        assert!(!out.ok);
        assert!(out
            .errors
            .iter()
            .any(|e| e.contains("Lambdas are only supported")));
        assert!(out.notes.iter().any(|n| n.contains("$reduce")));
    }

    #[test]
    fn infer_mode_produces_input_declaration() {
        let out = convert_jsonata("a.b", "data", &InputMode::Infer);
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "input data: { a: { b: unknown } }\n\nmap {\n  value: data.a.b,\n}\n"
        );
        assert_eq!(out.notes.len(), 2);
    }

    #[test]
    fn sample_mode_derives_precise_type() {
        let sample = serde_json::json!({ "a": { "b": 1 } });
        let out = convert_jsonata("a.b", "data", &InputMode::Sample(sample));
        assert!(out.ok, "errors: {:?}", out.errors);
        assert_eq!(
            out.typeflow,
            "input data: { a: { b: number } }\n\nmap {\n  value: data.a.b,\n}\n"
        );
    }
}
