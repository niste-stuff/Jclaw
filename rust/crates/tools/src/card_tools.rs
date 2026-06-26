//! Janitor AI character-card authoring tools: `validate_card` and
//! `token_budget_check`.
//!
//! These replace the codebase-oriented tools for the `claw-janitor` agent. A
//! character card is not a codebase, so file/edit/search tools have nothing
//! valid to act on; the agent instead drafts a card and self-checks it with the
//! two tools below.
//!
//! Card shape targeted: the SillyTavern V2-style JSON object that Janitor AI
//! imports/exports — `name`, `description`, `personality`, `scenario`,
//! `first_mes`, `mes_example`, `tags`. Required-vs-optional and the token
//! budgets below come from the schema sources recorded in `DECISIONS.md`.

use serde_json::{json, Value};

/// Required card fields (must be present and non-empty).
const REQUIRED_FIELDS: &[&str] = &["name", "personality", "first_mes"];
/// Optional but recommended definition fields.
const OPTIONAL_FIELDS: &[&str] = &["description", "scenario", "mes_example"];

/// Personality should stay under this many estimated tokens (hard max from the
/// community bot-creation guide; ideal range is 200-1500).
const PERSONALITY_MAX_TOKENS: usize = 2000;
/// Permanent (always-in-context) definition tokens should stay under this.
const PERMANENT_MAX_TOKENS: usize = 2500;
/// Soft warning threshold for the personality field.
const PERSONALITY_WARN_TOKENS: usize = 1500;

/// Rough token estimate. Phase 1 uses the common ~4-chars-per-token heuristic
/// rather than pulling in a model-specific tokenizer; the output labels this an
/// estimate so callers do not over-trust it.
#[must_use]
pub fn estimate_tokens(text: &str) -> usize {
    let chars = text.chars().count();
    chars.div_ceil(4)
}

fn card_object(input: &Value) -> Result<Value, String> {
    let card = input.get("card").unwrap_or(input);
    if !card.is_object() {
        return Err("expected a `card` object (or the card fields at top level)".to_string());
    }
    Ok(card.clone())
}

fn field_str<'a>(card: &'a Value, key: &str) -> Option<&'a str> {
    card.get(key).and_then(Value::as_str)
}

/// `validate_card`: structural check of a Janitor card against the schema.
/// Returns a JSON report string: `{ valid, errors, warnings, fields_present }`.
pub fn validate_card(input: &Value) -> Result<String, String> {
    let card = card_object(input)?;
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for field in REQUIRED_FIELDS {
        match field_str(&card, field) {
            Some(v) if !v.trim().is_empty() => {}
            Some(_) => errors.push(format!("required field `{field}` is empty")),
            None => errors.push(format!("required field `{field}` is missing")),
        }
    }

    // tags: at least one required by Janitor; accept array of strings.
    match card.get("tags") {
        Some(Value::Array(tags)) if !tags.is_empty() => {
            if tags.iter().any(|t| !t.is_string()) {
                errors.push("`tags` must be an array of strings".to_string());
            }
            if tags.len() > 10 {
                warnings.push(format!(
                    "`tags` has {} entries; Janitor allows at most 10",
                    tags.len()
                ));
            }
        }
        Some(Value::Array(_)) => {
            errors.push("`tags` is empty; at least one tag is required".to_string())
        }
        Some(_) => errors.push("`tags` must be an array of strings".to_string()),
        None => errors.push("required field `tags` is missing (at least one tag)".to_string()),
    }

    for field in OPTIONAL_FIELDS {
        if field_str(&card, field)
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            warnings.push(format!("recommended field `{field}` is empty or missing"));
        }
    }

    // {{char}}/{{user}} sanity: first_mes/mes_example commonly use {{user}};
    // catch obvious malformed placeholders like single braces or {{ char }}.
    let mut placeholder_carriers = vec![];
    for field in ["personality", "scenario", "first_mes", "mes_example"] {
        if let Some(text) = field_str(&card, field) {
            placeholder_carriers.push((field, text));
        }
    }
    for (field, text) in &placeholder_carriers {
        check_placeholders(field, text, &mut warnings);
    }

    let valid = errors.is_empty();
    let report = json!({
        "valid": valid,
        "errors": errors,
        "warnings": warnings,
        "fields_present": present_fields(&card),
    });
    Ok(report.to_string())
}

fn check_placeholders(field: &str, text: &str, warnings: &mut Vec<String>) {
    // Detect spaced placeholders that won't be substituted: {{ char }}.
    if text.contains("{{ char }}") || text.contains("{{ user }}") {
        warnings.push(format!(
            "`{field}` contains a spaced placeholder (e.g. `{{{{ char }}}}`); Janitor only substitutes `{{{{char}}}}` and `{{{{user}}}}`"
        ));
    }
    // Detect an unknown placeholder token: {{something}} that isn't char/user.
    let mut rest = text;
    while let Some(open) = rest.find("{{") {
        if let Some(close) = rest[open..].find("}}") {
            let inner = rest[open + 2..open + close].trim();
            if !inner.is_empty() && inner != "char" && inner != "user" {
                warnings.push(format!(
                    "`{field}` uses unknown placeholder `{{{{{inner}}}}}`; Janitor recognizes only `{{{{char}}}}` and `{{{{user}}}}`"
                ));
            }
            rest = &rest[open + close + 2..];
        } else {
            break;
        }
    }
}

fn present_fields(card: &Value) -> Vec<String> {
    let mut present = vec![];
    if let Some(obj) = card.as_object() {
        for (k, v) in obj {
            let non_empty = match v {
                Value::String(s) => !s.trim().is_empty(),
                Value::Array(a) => !a.is_empty(),
                Value::Null => false,
                _ => true,
            };
            if non_empty {
                present.push(k.clone());
            }
        }
    }
    present.sort();
    present
}

/// `token_budget_check`: estimate per-field tokens and flag fields/totals that
/// exceed Janitor's practical context budget. Returns a JSON report string.
pub fn token_budget_check(input: &Value) -> Result<String, String> {
    let card = card_object(input)?;

    let personality = estimate_tokens(field_str(&card, "personality").unwrap_or(""));
    let scenario = estimate_tokens(field_str(&card, "scenario").unwrap_or(""));
    let mes_example = estimate_tokens(field_str(&card, "mes_example").unwrap_or(""));
    let first_mes = estimate_tokens(field_str(&card, "first_mes").unwrap_or(""));
    let description = estimate_tokens(field_str(&card, "description").unwrap_or(""));

    // Permanent (always-injected) definition tokens. `description` is the
    // user-facing bio and is not sent to the model, so it is reported but
    // excluded from the permanent budget.
    let permanent = personality + scenario + mes_example;

    let mut flags: Vec<String> = Vec::new();
    if personality > PERSONALITY_MAX_TOKENS {
        flags.push(format!(
            "personality ~{personality} tokens exceeds hard max {PERSONALITY_MAX_TOKENS}; trim it"
        ));
    } else if personality > PERSONALITY_WARN_TOKENS {
        flags.push(format!(
            "personality ~{personality} tokens is above the recommended {PERSONALITY_WARN_TOKENS}; consider trimming"
        ));
    }
    if permanent > PERMANENT_MAX_TOKENS {
        flags.push(format!(
            "permanent tokens ~{permanent} (personality+scenario+mes_example) exceeds {PERMANENT_MAX_TOKENS}; memory may degrade"
        ));
    }

    let within_budget = flags.is_empty();
    let report = json!({
        "within_budget": within_budget,
        "estimate_method": "approx chars/4 (not a model tokenizer)",
        "per_field_tokens": {
            "personality": personality,
            "scenario": scenario,
            "mes_example": mes_example,
            "first_mes": first_mes,
            "description": description,
        },
        "permanent_tokens": permanent,
        "limits": {
            "personality_max": PERSONALITY_MAX_TOKENS,
            "personality_warn": PERSONALITY_WARN_TOKENS,
            "permanent_max": PERMANENT_MAX_TOKENS,
        },
        "flags": flags,
    });
    Ok(report.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_card() -> Value {
        json!({
            "card": {
                "name": "Aria",
                "description": "A short bio.",
                "personality": "{{char}} is warm and witty.",
                "scenario": "{{user}} meets {{char}} at a cafe.",
                "first_mes": "Hi {{user}}, fancy seeing you here!",
                "mes_example": "{{char}}: Tea?\n{{user}}: Sure.",
                "tags": ["oc", "romance"]
            }
        })
    }

    #[test]
    fn valid_card_passes() {
        let out = validate_card(&good_card()).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert_eq!(v["errors"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn missing_required_fails() {
        let out = validate_card(&json!({"card": {"name": "X", "tags": ["a"]}})).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        let errs = v["errors"].as_array().unwrap();
        assert!(errs
            .iter()
            .any(|e| e.as_str().unwrap().contains("personality")));
        assert!(errs
            .iter()
            .any(|e| e.as_str().unwrap().contains("first_mes")));
    }

    #[test]
    fn missing_tags_fails() {
        let out =
            validate_card(&json!({"card": {"name": "X", "personality": "p", "first_mes": "hi"}}))
                .unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        assert!(v["errors"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e.as_str().unwrap().contains("tags")));
    }

    #[test]
    fn unknown_placeholder_warns() {
        let card = json!({"card": {
            "name": "X", "personality": "{{persona}} hello", "first_mes": "hi", "tags": ["a"]
        }});
        let out = validate_card(&card).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w.as_str().unwrap().contains("persona")));
    }

    #[test]
    fn token_budget_flags_oversized_personality() {
        let big = "word ".repeat(3000); // ~3750 est tokens
        let card = json!({"card": {"personality": big}});
        let out = token_budget_check(&card).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["within_budget"], json!(false));
        assert!(v["flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f.as_str().unwrap().contains("hard max")));
    }

    #[test]
    fn token_budget_passes_small_card() {
        let out = token_budget_check(&good_card()).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["within_budget"], json!(true), "report: {out}");
    }

    #[test]
    fn estimate_is_ceil_div_4() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }
}
