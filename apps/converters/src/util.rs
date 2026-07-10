//! Small helpers shared by every module: JS-compatible number formatting,
//! JSON string quoting (JSON.stringify), identifier tests. Byte-for-byte
//! parity with the TypeScript implementation is the goal — the differential
//! tests compare raw output strings.

/// `JSON.stringify(value)` for a string: double quotes, standard escapes,
/// `\u00XX` for other control characters, non-ASCII kept literal.
pub fn json_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `^[A-Za-z_$][A-Za-z0-9_$]*$`
pub fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// A property/field name as Typeflow prints it: bare when it is an
/// identifier, JSON-quoted otherwise.
pub fn prop_name(name: &str) -> String {
    if is_ident(name) {
        name.to_string()
    } else {
        json_quote(name)
    }
}

/// ECMAScript `String(number)` (Number::toString radix 10). Rust's shortest
/// round-trip digits are the same as V8's; only the layout rules differ, so
/// reproduce ECMA-262's placement of the decimal point / exponent.
pub fn js_num(v: f64) -> String {
    if v.is_nan() {
        return "NaN".to_string();
    }
    if v == 0.0 {
        return "0".to_string();
    }
    if v.is_infinite() {
        return if v > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    let neg = v < 0.0;
    let v = v.abs();
    // `{:e}` prints the shortest round-trip mantissa, e.g. "1.25e2".
    let exp_form = format!("{:e}", v);
    let (mantissa, exp) = exp_form.split_once('e').expect("exponent form");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i64; // number of significant digits
    let n = exp.parse::<i64>().expect("exponent") + 1; // decimal point position
    let body = if k <= n && n <= 21 {
        // Integer with trailing zeros.
        let mut s = digits.clone();
        s.extend(std::iter::repeat('0').take((n - k) as usize));
        s
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        let zeros: String = std::iter::repeat('0').take((-n) as usize).collect();
        format!("0.{}{}", zeros, digits)
    } else {
        // Exponent notation.
        let head = &digits[..1];
        let rest = &digits[1..];
        let e = n - 1;
        let sign = if e >= 0 { "+" } else { "-" };
        if rest.is_empty() {
            format!("{}e{}{}", head, sign, e.abs())
        } else {
            format!("{}.{}e{}{}", head, rest, sign, e.abs())
        }
    };
    if neg {
        format!("-{}", body)
    } else {
        body
    }
}

/// `Number.parseFloat`: parse the longest valid float prefix of `raw`
/// (which starts with a digit here), NaN never occurs for our callers.
pub fn js_parse_float(raw: &str) -> f64 {
    let bytes = raw.as_bytes();
    let mut end = 0;
    // integer part
    while end < bytes.len() && bytes[end].is_ascii_digit() {
        end += 1;
    }
    // fraction
    if end < bytes.len() && bytes[end] == b'.' {
        let mut j = end + 1;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        end = j; // parseFloat accepts "1." as 1
    }
    // exponent — only if a full, valid exponent follows
    if end < bytes.len() && (bytes[end] == b'e' || bytes[end] == b'E') {
        let mut j = end + 1;
        if j < bytes.len() && (bytes[j] == b'+' || bytes[j] == b'-') {
            j += 1;
        }
        if j < bytes.len() && bytes[j].is_ascii_digit() {
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            end = j;
        }
    }
    raw[..end].parse::<f64>().unwrap_or(f64::NAN)
}

/// `[...new Set(items)]` — dedupe preserving first-occurrence order.
pub fn dedupe(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items {
        if seen.insert(item.clone()) {
            out.push(item);
        }
    }
    out
}
