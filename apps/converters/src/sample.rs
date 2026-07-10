//! Infer an inline Typeflow input type from a sample JSON value (port of
//! `src/converter/jsonata/sample-type.ts`). Uses serde_json with
//! `preserve_order` so object fields keep their source order, like JS objects.

use crate::util::{is_ident, json_quote};
use serde_json::Value;

fn field_name(key: &str) -> String {
    if is_ident(key) {
        key.to_string()
    } else {
        json_quote(key)
    }
}

fn render_object(obj: &serde_json::Map<String, Value>) -> String {
    let fields: Vec<String> = obj
        .iter()
        .map(|(key, value)| format!("{}: {}", field_name(key), render(value)))
        .collect();
    if fields.is_empty() {
        "{}".to_string()
    } else {
        format!("{{ {} }}", fields.join(", "))
    }
}

/// Arrays of objects merge their elements: missing-somewhere keys become optional.
fn render_merged_objects(objs: &[&serde_json::Map<String, Value>]) -> String {
    let mut keys: Vec<&String> = Vec::new();
    for o in objs {
        for k in o.keys() {
            if !keys.contains(&k) {
                keys.push(k);
            }
        }
    }
    let fields: Vec<String> = keys
        .iter()
        .map(|key| {
            let present: Vec<&&serde_json::Map<String, Value>> =
                objs.iter().filter(|o| o.contains_key(*key)).collect();
            let mut kinds: Vec<String> = Vec::new();
            for o in &present {
                let kind = render(&o[*key]);
                if !kinds.contains(&kind) {
                    kinds.push(kind);
                }
            }
            let type_ = if kinds.len() == 1 {
                kinds[0].clone()
            } else {
                kinds.join(" | ")
            };
            let optional = if present.len() < objs.len() { "?" } else { "" };
            format!("{}{}: {}", field_name(key), optional, type_)
        })
        .collect();
    if fields.is_empty() {
        "{}".to_string()
    } else {
        format!("{{ {} }}", fields.join(", "))
    }
}

fn render(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::String(_) => "string".to_string(),
        Value::Number(_) => "number".to_string(),
        Value::Bool(_) => "boolean".to_string(),
        Value::Array(items) => {
            if items.is_empty() {
                return "unknown[]".to_string();
            }
            let objs: Vec<&serde_json::Map<String, Value>> =
                items.iter().filter_map(|i| i.as_object()).collect();
            if objs.len() == items.len() {
                return format!("{}[]", render_merged_objects(&objs));
            }
            let mut kinds: Vec<String> = Vec::new();
            for item in items {
                let kind = render(item);
                if !kinds.contains(&kind) {
                    kinds.push(kind);
                }
            }
            if kinds.len() == 1 {
                format!("{}[]", kinds[0])
            } else {
                format!("({})[]", kinds.join(" | "))
            }
        }
        Value::Object(obj) => render_object(obj),
    }
}

/// Render the inline Typeflow type of a sample JSON value, e.g.
/// `{ "id": 1, "tags": ["a"] }` → `{ id: number, tags: string[] }`.
pub fn type_from_sample(value: &Value) -> String {
    render(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn flat_object_renders_field_by_field() {
        let sample = json!({ "id": 1, "name": "a", "ok": true, "nil": null });
        assert_eq!(
            type_from_sample(&sample),
            "{ id: number, name: string, ok: boolean, nil: null }"
        );
    }

    #[test]
    fn arrays_of_objects_merge_fields_and_mark_partial_ones_optional() {
        let sample = json!({
            "items": [{ "a": 1 }, { "a": 2, "b": "x" }],
            "empty": [],
            "mixed": [1, "a", true],
        });
        assert_eq!(
            type_from_sample(&sample),
            "{ items: { a: number, b?: string }[], empty: unknown[], mixed: (number | string | boolean)[] }"
        );
    }

    #[test]
    fn empty_array_is_unknown_array() {
        assert_eq!(type_from_sample(&json!([])), "unknown[]");
    }

    #[test]
    fn bare_scalars() {
        assert_eq!(type_from_sample(&json!("plain")), "string");
        assert_eq!(type_from_sample(&json!(42)), "number");
    }

    #[test]
    fn non_identifier_keys_are_quoted() {
        let sample = json!({ "odd key": [{ "inner key": 1 }] });
        assert_eq!(
            type_from_sample(&sample),
            "{ \"odd key\": { \"inner key\": number }[] }"
        );
    }
}
