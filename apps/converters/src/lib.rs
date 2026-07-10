//! Typeflow converters as a native Node.js addon (napi-rs).
//!
//! Rust port of the TypeScript converters in the main `typeflow` package
//! (`src/converter/jq`, `src/converter/jsonata`), including the Typeflow
//! parser + canonical formatter they rely on. Output is byte-identical to
//! the TypeScript implementation (validated by the differential tests in
//! `test/`).

#[macro_use]
extern crate napi_derive;

mod jq;
mod jsonata;
mod sample;
mod tf;
mod util;

use jq::InputMode;
use rayon::prelude::*;

#[napi(object)]
pub struct ConvertResult {
    pub ok: bool,
    /// Generated Typeflow source (canonically formatted when `ok`).
    pub typeflow: String,
    /// Semantic caveats worth reviewing after conversion.
    pub notes: Vec<String>,
    /// Unsupported constructs; when non-empty, `ok` is false.
    pub errors: Vec<String>,
}

#[napi(object)]
#[derive(Default)]
pub struct ConvertOptions {
    /// Name of the Typeflow input binding (default: "data").
    pub input_name: Option<String>,
    /// How to produce the `input` declaration: "infer" (default) or "none".
    pub input: Option<String>,
    /// JSON-serialized sample value; when set, wins over `input` and the
    /// type is derived from it (most precise).
    pub input_sample_json: Option<String>,
}

fn input_mode(options: &ConvertOptions) -> Result<InputMode, String> {
    if let Some(json) = &options.input_sample_json {
        let value: serde_json::Value =
            serde_json::from_str(json).map_err(|e| format!("Invalid inputSampleJson: {}.", e))?;
        return Ok(InputMode::Sample(value));
    }
    match options.input.as_deref() {
        None | Some("infer") => Ok(InputMode::Infer),
        Some("none") => Ok(InputMode::None),
        Some(other) => Err(format!(
            "Invalid input option '{}': expected 'infer' or 'none'.",
            other
        )),
    }
}

fn to_result(outcome: jq::ConvertOutcome) -> ConvertResult {
    ConvertResult {
        ok: outcome.ok,
        typeflow: outcome.typeflow,
        notes: outcome.notes,
        errors: outcome.errors,
    }
}

fn bad_options(message: String) -> ConvertResult {
    ConvertResult {
        ok: false,
        typeflow: String::new(),
        notes: Vec::new(),
        errors: vec![message],
    }
}

/// Convert a jq mapping expression to Typeflow source.
#[napi]
pub fn convert_jq(source: String, options: Option<ConvertOptions>) -> ConvertResult {
    let options = options.unwrap_or_default();
    let input_name = options
        .input_name
        .clone()
        .unwrap_or_else(|| "data".to_string());
    match input_mode(&options) {
        Ok(mode) => to_result(jq::convert_jq(&source, &input_name, &mode)),
        Err(message) => bad_options(message),
    }
}

/// Convert a JSONata mapping expression to Typeflow source.
#[napi]
pub fn convert_jsonata(source: String, options: Option<ConvertOptions>) -> ConvertResult {
    let options = options.unwrap_or_default();
    let input_name = options
        .input_name
        .clone()
        .unwrap_or_else(|| "data".to_string());
    match input_mode(&options) {
        Ok(mode) => to_result(jsonata::convert_jsonata(&source, &input_name, &mode)),
        Err(message) => bad_options(message),
    }
}

/// Convert many jq mapping expressions to Typeflow source, in parallel across
/// CPU cores (rayon) — one `input`/`options` pair shared by the whole batch.
/// This is the entry point multi-file callers (e.g. the CLI's `convert`
/// command) should use instead of looping over `convertJq`: a loop pays one
/// FFI round-trip per file and runs single-threaded, defeating the point of
/// doing this work in Rust.
#[napi]
pub fn convert_jq_batch(
    sources: Vec<String>,
    options: Option<ConvertOptions>,
) -> Vec<ConvertResult> {
    let options = options.unwrap_or_default();
    let input_name = options
        .input_name
        .clone()
        .unwrap_or_else(|| "data".to_string());
    match input_mode(&options) {
        Ok(mode) => sources
            .par_iter()
            .map(|source| to_result(jq::convert_jq(source, &input_name, &mode)))
            .collect(),
        Err(message) => sources
            .iter()
            .map(|_| bad_options(message.clone()))
            .collect(),
    }
}

/// Convert many JSONata mapping expressions to Typeflow source, in parallel
/// across CPU cores (rayon). See `convertJqBatch` for why this exists.
#[napi]
pub fn convert_jsonata_batch(
    sources: Vec<String>,
    options: Option<ConvertOptions>,
) -> Vec<ConvertResult> {
    let options = options.unwrap_or_default();
    let input_name = options
        .input_name
        .clone()
        .unwrap_or_else(|| "data".to_string());
    match input_mode(&options) {
        Ok(mode) => sources
            .par_iter()
            .map(|source| to_result(jsonata::convert_jsonata(source, &input_name, &mode)))
            .collect(),
        Err(message) => sources
            .iter()
            .map(|_| bad_options(message.clone()))
            .collect(),
    }
}

#[napi(object)]
pub struct FormatTypeflowResult {
    pub ok: bool,
    /// Canonical source when `ok`; the input unchanged otherwise.
    pub formatted: String,
    /// Parse error message when not `ok`.
    pub error: Option<String>,
}

/// Format a `.typeflow` source into its canonical form.
#[napi]
pub fn format_typeflow(source: String) -> FormatTypeflowResult {
    let result = tf::format::format(&source);
    FormatTypeflowResult {
        ok: result.ok,
        formatted: result.formatted,
        error: result.error,
    }
}

/// Render the inline Typeflow type of a sample JSON value (passed serialized),
/// e.g. `{"id":1,"tags":["a"]}` → `{ id: number, tags: string[] }`.
#[napi]
pub fn type_from_sample(sample_json: String) -> napi::Result<String> {
    let value: serde_json::Value = serde_json::from_str(&sample_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid sample JSON: {}.", e)))?;
    Ok(sample::type_from_sample(&value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none_options() -> ConvertOptions {
        ConvertOptions {
            input: Some("none".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn invalid_input_option_is_rejected_before_conversion_runs() {
        let result = convert_jq(
            "{ a: .x }".to_string(),
            Some(ConvertOptions {
                input: Some("bogus".to_string()),
                ..Default::default()
            }),
        );
        assert!(!result.ok);
        assert_eq!(
            result.errors,
            vec!["Invalid input option 'bogus': expected 'infer' or 'none'.".to_string()]
        );
    }

    #[test]
    fn convert_jq_defaults_to_data_input_name() {
        let result = convert_jq("{ id: .id }".to_string(), None);
        assert!(result.ok, "errors: {:?}", result.errors);
        assert!(result.typeflow.contains("data.id"));
    }

    #[test]
    fn batch_matches_sequential_calls_one_by_one() {
        let sources = vec![
            "{ a: .x }".to_string(),
            ".arr[0]".to_string(),
            "{ b: .y.z }".to_string(),
        ];
        let batch = convert_jq_batch(sources.clone(), Some(none_options()));
        assert_eq!(batch.len(), sources.len());
        for (source, batched) in sources.iter().zip(batch.iter()) {
            let single = convert_jq(source.clone(), Some(none_options()));
            assert_eq!(batched.ok, single.ok);
            assert_eq!(batched.typeflow, single.typeflow);
            assert_eq!(batched.errors, single.errors);
        }
    }

    #[test]
    fn batch_reports_per_item_failures_without_failing_the_whole_batch() {
        let sources = vec!["a.b".to_string(), "$bad(".to_string()];
        let results = convert_jsonata_batch(sources, Some(none_options()));
        assert_eq!(results.len(), 2);
        assert!(results[0].ok, "errors: {:?}", results[0].errors);
        assert!(!results[1].ok);
        assert!(!results[1].errors.is_empty());
    }

    #[test]
    fn batch_with_invalid_options_fans_out_the_same_error_to_every_item() {
        let sources = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let bad = ConvertOptions {
            input: Some("bogus".to_string()),
            ..Default::default()
        };
        let results = convert_jq_batch(sources.clone(), Some(bad));
        assert_eq!(results.len(), sources.len());
        for result in &results {
            assert!(!result.ok);
            assert_eq!(
                result.errors,
                vec!["Invalid input option 'bogus': expected 'infer' or 'none'.".to_string()]
            );
        }
    }

    #[test]
    fn empty_batch_returns_empty_results() {
        assert!(convert_jq_batch(Vec::new(), None).is_empty());
        assert!(convert_jsonata_batch(Vec::new(), None).is_empty());
    }

    #[test]
    fn format_typeflow_round_trips_valid_source() {
        let result = format_typeflow("map{x:1}".to_string());
        assert!(result.ok);
        assert_eq!(result.formatted, "map {\n  x: 1,\n}\n");
        assert!(result.error.is_none());
    }

    #[test]
    fn type_from_sample_rejects_invalid_json() {
        let err = type_from_sample("not json".to_string());
        assert!(err.is_err());
    }

    #[test]
    fn type_from_sample_renders_object_type() {
        let out = type_from_sample(r#"{"id":1,"tags":["a"]}"#.to_string()).unwrap();
        assert_eq!(out, "{ id: number, tags: string[] }");
    }
}
