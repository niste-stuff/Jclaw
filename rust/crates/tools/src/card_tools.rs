//! Janitor AI character-card authoring tools: `validate_card` and
//! `token_budget_check`.
//!
//! Cards are Markdown files with `# Section` headers and `---` separators
//! between sections. Each section maps to a field in the Janitor AI bot
//! creation page. The user copies individual sections from the file and
//! pastes them into the bot maker — the file is a workspace format, not
//! a direct import format.
//!
//! Section format:
//! ```markdown
//! # Name
//! Character Name
//!
//! ---
//!
//! # Personality
//! Traits, backstory, speech patterns, mannerisms.
//!
//! ---
//!
//! # Opening Messages
//! First opening message...
//!
//! ---
//!
//! Second opening message...
//! ```
//!
//! Required: Name, Personality, Opening Messages (1-10 individual messages).
//! Everything else is optional.
//!
//! Token budgets below come from the schema sources recorded in `DECISIONS.md`.

use serde_json::{json, Value};

/// Marker tokens for parsed sections
const SECTION_NAME: &str = "name";
const SECTION_PERSONALITY: &str = "personality";
const SECTION_OPENING_MESSAGES: &str = "opening_messages";
const SECTION_DESCRIPTION: &str = "description";
const SECTION_SCENARIO: &str = "scenario";
const SECTION_EXAMPLE_MESSAGES: &str = "example_messages";

/// Required sections (must be present with non-empty content).
const REQUIRED_SECTIONS: &[&str] = &[SECTION_NAME, SECTION_PERSONALITY, SECTION_OPENING_MESSAGES];

/// Optional but recognized sections.
const OPTIONAL_SECTIONS: &[&str] =
    &[SECTION_DESCRIPTION, SECTION_SCENARIO, SECTION_EXAMPLE_MESSAGES];

/// Personality under this many estimated tokens suggests low-quality definition.
const PERSONALITY_LOW_QUALITY: usize = 1000;
/// Personality in the 1k-4k range is the sweet spot — aim for this.
const PERSONALITY_TARGET_MAX: usize = 4000;
/// Personality over this is too much for most use cases; avoid unless user asks.
const PERSONALITY_TOO_MUCH: usize = 5000;
/// Permanent definition (personality+scenario+example) sweet spot upper bound.
const PERMANENT_TARGET_MAX: usize = 5000;
/// Permanent definition over this is excessive; avoid unless user asks.
const PERMANENT_TOO_MUCH: usize = 6000;
/// Max opening messages.
const OPENING_MESSAGES_MAX: usize = 10;
/// Min opening messages.
const OPENING_MESSAGES_MIN: usize = 1;

/// A parsed card section.
#[derive(Debug, Clone)]
struct CardSection {
    /// Normalised (lowercased, space-collapsed) section name for matching.
    slug: String,
    /// Original header text (e.g. "Opening Messages").
    header: String,
    /// Clean body content (leading/trailing whitespace and separator lines
    /// removed; for Opening Messages, the raw joined body before message split).
    body: String,
    /// For Opening Messages: individual messages (separated by `---` lines).
    messages: Vec<String>,
    /// Whether the section was actually named by the user (vs matched by
    /// slug normalisation). Unrecognised sections get a warning.
    recognised: bool,
}

/// Normalise a section header to a match key.
fn normalise_header(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_")
}

/// Known section header slugs and their canonical label.
fn known_sections() -> Vec<(&'static str, &'static str)> {
    vec![
        (SECTION_NAME, "Name"),
        (SECTION_PERSONALITY, "Personality"),
        (SECTION_OPENING_MESSAGES, "Opening Messages"),
        (SECTION_DESCRIPTION, "Description"),
        (SECTION_SCENARIO, "Scenario"),
        (SECTION_EXAMPLE_MESSAGES, "Example Messages"),
    ]
}

/// Parse a Markdown card text into a list of sections.
fn parse_sections(text: &str) -> Vec<CardSection> {
    let known: Vec<(String, &str)> = known_sections()
        .into_iter()
        .map(|(slug, label)| (slug.to_string(), label))
        .collect();

    let mut sections: Vec<CardSection> = Vec::new();
    let mut current_header: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();

    for line in text.lines() {
        if line.starts_with('#') {
            // Flush previous section
            if let Some(header) = current_header.take() {
                let raw_body = current_lines.join("\n");
                let body = clean_section_body(&raw_body);
                let section = build_section(&header, &body, &known);
                sections.push(section);
                current_lines.clear();
            }
            // Start new section
            current_header = Some(
                line.trim_start_matches('#')
                    .trim()
                    .to_string(),
            );
        } else if current_header.is_some() {
            current_lines.push(line.to_string());
        }
    }

    // Flush last section
    if let Some(header) = current_header {
        let raw_body = current_lines.join("\n");
        let body = clean_section_body(&raw_body);
        let section = build_section(&header, &body, &known);
        sections.push(section);
    }

    sections
}

/// Remove leading/trailing whitespace and `---` separator lines from a section
/// body. A `---` line at the very start or very end of the body is an
/// inter-section separator, not content.
fn clean_section_body(raw: &str) -> String {
    let trimmed = raw.trim();
    let lines: Vec<&str> = trimmed.lines().collect();
    let mut start = 0;
    let mut end = lines.len();

    // Strip leading `---` lines
    while start < end && lines[start].trim() == "---" {
        start += 1;
    }
    // Strip trailing `---` lines
    while end > start && lines[end - 1].trim() == "---" {
        end -= 1;
    }

    let body_lines: Vec<&str> = lines[start..end]
        .iter()
        .map(|l| l.trim_end())
        .collect();
    body_lines.join("\n").trim().to_string()
}

/// Build a CardSection from a header and cleaned body.
fn build_section(
    header: &str,
    body: &str,
    known: &[(String, &str)],
) -> CardSection {
    let slug = normalise_header(header);
    let recognised = known.iter().any(|(k, _)| k == &slug);

    let messages = if recognised && slug == SECTION_OPENING_MESSAGES {
        split_opening_messages(body)
    } else {
        Vec::new()
    };

    CardSection {
        slug,
        header: header.to_string(),
        body: body.to_string(),
        messages,
        recognised,
    }
}

/// Split the Opening Messages body into individual messages on `---` separator
/// lines.
fn split_opening_messages(body: &str) -> Vec<String> {
    let mut messages: Vec<String> = Vec::new();
    let mut current = Vec::new();

    for line in body.lines() {
        if line.trim() == "---" {
            let msg = current.join("\n").trim().to_string();
            if !msg.is_empty() {
                messages.push(msg);
            }
            current.clear();
        } else {
            current.push(line.to_string());
        }
    }

    // Last message (if any)
    let last = current.join("\n").trim().to_string();
    if !last.is_empty() {
        messages.push(last);
    }

    messages
}

/// Rough token estimate: ~4 chars per token heuristic.
#[must_use]
pub fn estimate_tokens(text: &str) -> usize {
    let chars = text.chars().count();
    chars.div_ceil(4)
}

/// `validate_card`: structural check of a Janitor card written in Markdown.
/// Returns a JSON report string: `{ valid, errors, warnings, sections_present }`.
pub fn validate_card(input: &Value) -> Result<String, String> {
    let text = extract_text_input(input)?;
    let sections = parse_sections(&text);

    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    // Build lookup by slug
    let section_map: std::collections::HashMap<String, &CardSection> = sections
        .iter()
        .map(|s| (s.slug.clone(), s))
        .collect();

    // Check required sections
    for slug in REQUIRED_SECTIONS {
        match section_map.get(*slug) {
            Some(s) if !s.body.is_empty() => {}
            Some(s) => errors.push(format!(
                "required section `{}` is empty after parsing",
                s.header
            )),
            None => {
                // Try to present a helpful name
                let name = known_sections()
                    .iter()
                    .find(|(k, _)| k == slug)
                    .map_or(*slug, |(_, label)| *label);
                errors.push(format!("required section `{name}` is missing"));
            }
        }
    }

    // Check opening messages count
    if let Some(section) = section_map.get(SECTION_OPENING_MESSAGES) {
        let count = section.messages.len();
        if count < OPENING_MESSAGES_MIN {
            errors.push(format!(
                "section `{}` has {} message(s); at least {OPENING_MESSAGES_MIN} required",
                section.header, count
            ));
        } else if count > OPENING_MESSAGES_MAX {
            errors.push(format!(
                "section `{}` has {} messages; max allowed is {OPENING_MESSAGES_MAX}",
                section.header, count
            ));
        }
    }

    // Warn about missing optional sections
    for slug in OPTIONAL_SECTIONS {
        if !section_map.contains_key(*slug) || section_map.get(*slug).map_or(true, |s| s.body.is_empty()) {
            let name = known_sections()
                .iter()
                .find(|(k, _)| k == slug)
                .map_or(slug.to_string(), |(_, label)| format!("`{label}`"));
            warnings.push(format!("optional section {name} is empty or missing"));
        }
    }

    // Warn about unrecognised sections
    for section in &sections {
        if !section.recognised && !section.body.is_empty() {
            warnings.push(format!(
                "unrecognised section `{}` — review whether it matches the expected card format",
                section.header
            ));
        }
    }

    // {{char}}/{{user}} placeholder sanity
    let text_fields: Vec<&str> = sections
        .iter()
        .filter(|s| s.recognised)
        .map(|s| s.body.as_str())
        .collect();
    for text in &text_fields {
        check_placeholders(text, &mut warnings);
    }

    let mut section_names: Vec<String> = sections
        .iter()
        .filter(|s| s.recognised && !s.body.is_empty())
        .map(|s| s.slug.clone())
        .collect::<Vec<_>>();
    section_names.sort();

    let valid = errors.is_empty();
    let report = json!({
        "valid": valid,
        "errors": errors,
        "warnings": warnings,
        "sections_present": section_names,
        "opening_message_count": section_map
            .get(SECTION_OPENING_MESSAGES)
            .map(|s| s.messages.len())
            .unwrap_or(0),
    });
    Ok(report.to_string())
}

/// Extract input text from either `{"card": "..."}` (legacy compat) or raw
/// string value.
fn extract_text_input(input: &Value) -> Result<String, String> {
    // Check for a `card` wrapping key (legacy shape)
    if let Some(card) = input.get("card") {
        if let Some(text) = card.as_str() {
            return Ok(text.to_string());
        }
    }
    // Try direct string
    if let Some(text) = input.as_str() {
        return Ok(text.to_string());
    }
    // Fallback: serialise the Value to string (allow raw JSON compat for tests)
    if let Some(obj) = input.as_object() {
        // If it has markdown-style section headers, treat as string
        if obj.contains_key("card") {
            if let Some(inner) = obj.get("card").and_then(Value::as_str) {
                return Ok(inner.to_string());
            }
        }
    }
    Err("expected a string containing Markdown card text, or a `card` key containing one".to_string())
}

fn check_placeholders(text: &str, warnings: &mut Vec<String>) {
    if text.contains("{{ char }}") || text.contains("{{ user }}") {
        warnings.push(
            "text contains a spaced placeholder (e.g. `{{ char }}`); Janitor only substitutes `{{char}}` and `{{user}}` (no spaces inside braces)"
                .to_string(),
        );
    }

    // Detect unknown placeholder tokens
    let mut rest = text;
    while let Some(open) = rest.find("{{") {
        if let Some(close) = rest[open..].find("}}") {
            let inner = rest[open + 2..open + close].trim();
            if !inner.is_empty() && inner != "char" && inner != "user" {
                warnings.push(format!(
                    "unknown placeholder `{{{{{inner}}}}}`; Janitor recognises only `{{{{char}}}}` and `{{{{user}}}}`"
                ));
            }
            rest = &rest[open + close + 2..];
        } else {
            break;
        }
    }
}

/// `token_budget_check`: estimate per-section tokens and flag sections/totals
/// that exceed Janitor's practical context budget. Returns a JSON report string.
pub fn token_budget_check(input: &Value) -> Result<String, String> {
    let text = extract_text_input(input)?;
    let sections = parse_sections(&text);
    let section_map: std::collections::HashMap<String, &CardSection> = sections
        .iter()
        .map(|s| (s.slug.clone(), s))
        .collect();

    let personality_tokens = section_map
        .get(SECTION_PERSONALITY)
        .map_or(0, |s| estimate_tokens(&s.body));
    let scenario_tokens = section_map
        .get(SECTION_SCENARIO)
        .map_or(0, |s| estimate_tokens(&s.body));
    let example_tokens = section_map
        .get(SECTION_EXAMPLE_MESSAGES)
        .map_or(0, |s| estimate_tokens(&s.body));
    let opening_tokens = section_map
        .get(SECTION_OPENING_MESSAGES)
        .map_or(0, |s| estimate_tokens(&s.body));
    let description_tokens = section_map
        .get(SECTION_DESCRIPTION)
        .map_or(0, |s| estimate_tokens(&s.body));

    // Permanent (always-injected) definition tokens.
    // Description is user-facing and excluded from the permanent budget.
    let permanent = personality_tokens + scenario_tokens + example_tokens;

    let mut flags: Vec<String> = Vec::new();
    // Quality bands: 0-1k low, 1k-4k sweet spot, 4k-5k above ideal, >5k too much
    if personality_tokens < PERSONALITY_LOW_QUALITY {
        flags.push(format!(
            "personality ~{personality_tokens} tokens is low quality; avoid unless the user explicitly wants a short card"
        ));
    } else if personality_tokens > PERSONALITY_TOO_MUCH {
        flags.push(format!(
            "personality ~{personality_tokens} tokens is too much for most use cases; avoid unless the user explicitly requests a verbose card. Aim for 2k-4k tokens"
        ));
    } else if personality_tokens > PERSONALITY_TARGET_MAX {
        flags.push(format!(
            "personality ~{personality_tokens} tokens is above the ideal 2k-4k range; consider trimming unless the card needs the detail"
        ));
    }
    if permanent < PERSONALITY_LOW_QUALITY {
        flags.push(format!(
            "permanent definition (personality+scenario+example messages) is ~{permanent} tokens — low quality; avoid unless the user wants minimal cards"
        ));
    } else if permanent > PERMANENT_TOO_MUCH {
        flags.push(format!(
            "permanent definition (personality+scenario+example messages) is ~{permanent} tokens — excessive for most use cases; avoid unless the user explicitly requests it"
        ));
    } else if permanent > PERMANENT_TARGET_MAX {
        flags.push(format!(
            "permanent definition (personality+scenario+example messages) is ~{permanent} tokens — above the ideal range; consider trimming"
        ));
    }

    let within_budget = flags.is_empty();
    let report = json!({
        "within_budget": within_budget,
        "estimate_method": "approx chars/4 (not a model tokenizer)",
        "per_section_tokens": {
            "personality": personality_tokens,
            "scenario": scenario_tokens,
            "example_messages": example_tokens,
            "opening_messages": opening_tokens,
            "description": description_tokens,
        },
        "permanent_tokens": permanent,
        "limits": {
            "personality_low_quality": PERSONALITY_LOW_QUALITY,
            "personality_target_max": PERSONALITY_TARGET_MAX,
            "personality_too_much": PERSONALITY_TOO_MUCH,
            "permanent_target_max": PERMANENT_TARGET_MAX,
            "permanent_too_much": PERMANENT_TOO_MUCH,
        },
        "flags": flags,
    });
    Ok(report.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_card_text() -> &'static str {
        "# Name
Aria

---

# Description
A short bio for the user. The model never sees this.

---

# Personality
{{char}} is warm and witty. {{char}} speaks with a gentle cadence and often
uses dry humour.

---

# Scenario
{{user}} meets {{char}} at a quiet cafe tucked behind the library.

---

# Opening Messages
Hi {{user}}, fancy seeing you here!

---

The door chimes softly as {{user}} enters. {{char}} looks up and smiles.

---

# Example Messages
{{char}}: Tea? Earl Grey, your favourite.
{{user}}: You remembered.
{{char}}: (a soft laugh) I remember everything about you."
    }

    fn minimal_good_card() -> &'static str {
        "# Name
Kai

---

# Personality
{{char}} is a quiet observer who speaks in short, deliberate sentences.

---

# Opening Messages
The stars are out tonight. {{char}} gestures at the sky without looking at {{user}}."
    }

    #[test]
    fn valid_card_passes() {
        let input = json!({ "card": good_card_text() });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert_eq!(v["errors"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn minimal_card_passes() {
        let input = json!({ "card": minimal_good_card() });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert_eq!(v["errors"].as_array().unwrap().len(), 0);
        assert_eq!(v["opening_message_count"], json!(1));
    }

    #[test]
    fn missing_name_fails() {
        let text = "# Personality
p

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        assert!(v["errors"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e.as_str().unwrap().to_lowercase().contains("name")));
    }

    #[test]
    fn missing_personality_fails() {
        let text = "# Name
X

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        assert!(v["errors"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e.as_str().unwrap().to_lowercase().contains("personality")));
    }

    #[test]
    fn missing_opening_messages_fails() {
        let text = "# Name
X

---

# Personality
p";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        let errs = v["errors"].as_array().unwrap();
        assert!(errs
            .iter()
            .any(|e| e.as_str().unwrap().to_lowercase().contains("opening")));
    }

    #[test]
    fn too_many_opening_messages_fails() {
        let mut body = "# Name
X

---

# Personality
p

---

# Opening Messages
msg1".to_string();
        for i in 2..=12 {
            body.push_str(&format!("\n\n---\n\nmsg{i}"));
        }
        let input = json!({ "card": body });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        assert!(v["errors"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e.as_str().unwrap().to_lowercase().contains("max")));
    }

    #[test]
    fn empty_opening_messages_fails() {
        let text = "# Name
X

---

# Personality
p

---

# Opening Messages
";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        // Should fail either missing (empty parsed body) or 0 messages
        let errs = v["errors"].as_array().unwrap();
        assert!(!errs.is_empty(), "expected at least one error, got: {out}");
    }

    #[test]
    fn unknown_placeholder_warns() {
        let text = "# Name
X

---

# Personality
{{persona}} hello

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w.as_str().unwrap().contains("persona")));
    }

    #[test]
    fn token_budget_flags_oversized_personality() {
        let big = "word ".repeat(5000); // ~6250 est tokens, above 5k too-much threshold
        let text = format!(
            "# Name
X

---

# Personality
{big}

---

# Opening Messages
hi"
        );
        let input = json!({ "card": text });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["within_budget"], json!(false));
        assert!(v["flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f.as_str().unwrap().contains("too much")));
    }

    #[test]
    fn token_budget_passes_small_card() {
        let input = json!({ "card": good_card_text() });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        // Small cards are flagged as low quality under the new guidance
        assert_eq!(v["within_budget"], json!(false), "report: {out}");
        assert!(v["flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f.as_str().unwrap().contains("low quality")));
    }

    #[test]
    fn token_budget_passes_medium_card() {
        // A medium-sized personality (1000-4000 tokens) should pass cleanly
        let medium = "This character has a detailed personality that spans multiple facets. ".repeat(100);
        let text = format!(
            "# Name
X

---

# Personality
{medium}

---

# Opening Messages
Hello there."
        );
        let input = json!({ "card": text });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["within_budget"], json!(true), "report: {out}");
    }

    #[test]
    fn token_budget_excludes_description() {
        // Description is public-facing and should not count toward permanent
        let big = "word ".repeat(3000);
        // Personality needs to be >1000 tokens to avoid low-quality flag
        let medium_personality = "This character is defined by a rich inner world and complex motivations. ".repeat(80);
        let text = format!(
            "# Name
X

---

# Description
{big}

---

# Personality
{medium_personality}

---

# Opening Messages
hi"
        );
        let input = json!({ "card": text });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        // Description tokens should be reported but permanent should still pass
        assert!(v["per_section_tokens"]["description"].as_u64().unwrap_or(0) > 500);
        assert_eq!(v["within_budget"], json!(true), "report: {out}");
    }

    #[test]
    fn estimate_is_ceil_div_4() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn parse_sections_smoke_test() {
        let text = "# Name
Aria

---

# Personality
Smart.

---

# Opening Messages
Hi!";
        let sections = parse_sections(text);
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[0].slug, "name");
        assert_eq!(sections[1].slug, "personality");
        assert_eq!(sections[2].slug, "opening_messages");
    }

    #[test]
    fn direct_string_input_works() {
        let text = "# Name
X

---

# Personality
p

---

# Opening Messages
hi";
        let out = validate_card(&Value::String(text.to_string())).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true));
    }

    #[test]
    fn opening_messages_count_matches() {
        let text = "# Name
A

---

# Personality
B

---

# Opening Messages
One.

---

Two.

---

Three.";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["opening_message_count"], json!(3));
        assert_eq!(v["valid"], json!(true));
    }

    #[test]
    fn description_excluded_from_permanent_budget() {
        let desc = "word ".repeat(2000); // ~2000 chars, ~500 tokens
        // Personality needs to be >1000 tokens to avoid low-quality flag
        let med = "X is a friendly character with a warm personality and a great sense of humor. ".repeat(60);
        let text = format!(
            "# Name
X

---

# Description
{desc}

---

# Personality
{med}

---

# Opening Messages
Hello."
        );
        let out = token_budget_check(&json!({ "card": text })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        // Permanent should still pass since description isn't counted
        assert_eq!(v["within_budget"], json!(true));
        // But description tokens should be reported
        let desc_tokens = v["per_section_tokens"]["description"]
            .as_u64()
            .unwrap_or(0);
        assert!(desc_tokens > 0, "description should have token count");
    }

    #[test]
    fn scenario_and_example_messages_optional() {
        // No Scenario or Example Messages — should only warn, not error
        let text = "# Name
X

---

# Personality
p

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true));
        // Should warn about missing scenario, example messages, description
        assert!(!v["warnings"].as_array().unwrap().is_empty());
    }

    #[test]
    fn sections_sorted_in_present() {
        let text = "# Personality
p

---

# Opening Messages
hi

---

# Name
X";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true));
        let present = v["sections_present"].as_array().unwrap();
        // Should be sorted alphabetically by slug
        assert_eq!(present[0], json!("name"));
        assert_eq!(present[1], json!("opening_messages"));
        assert_eq!(present[2], json!("personality"));
    }
}
