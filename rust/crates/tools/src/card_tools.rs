//! Janitor AI character-card authoring tools: `validate_card` and
//! `token_budget_check`.
//!
//! Cards are Markdown files with `# Section` headers and `---` separators
//! between sections. Each section maps to a field in the Janitor AI bot
//! creation page. The user copies individual sections from the file and
//! pastes them into the bot maker — the file is a workspace format, not
//! a direct import format.
//!
//! The card is the four-box model: **Scenario, Personality (a.k.a.
//! Description), Opening Messages, Example Dialogue** — and nothing more.
//! There is no separate Name or Description box; a `# Description` block folds
//! into Personality.
//!
//! Section format:
//! ```markdown
//! # Scenario
//! The situation the roleplay opens in.
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
//!
//! ---
//!
//! # Example Dialogue
//! {{char}}: A sample exchange.
//! ```
//!
//! Required for validation: Personality, Opening Messages (1-10 individual
//! messages). Scenario and Example Dialogue are optional.
//!
//! Permanent per-turn budget = **Scenario + Personality only**. Example
//! Dialogue loads once and rolls off like chat history; only 1 of up to 10
//! Opening Messages loads. So neither counts toward the permanent budget.
//!
//! Token budgets below come from the schema sources recorded in `DECISIONS.md`.

use serde_json::{json, Value};

/// Marker tokens for parsed sections. The four boxes: Scenario, Personality
/// (a.k.a. Description), Opening Messages, Example Dialogue.
const SECTION_PERSONALITY: &str = "personality";
const SECTION_OPENING_MESSAGES: &str = "opening_messages";
const SECTION_SCENARIO: &str = "scenario";
const SECTION_EXAMPLE_MESSAGES: &str = "example_messages";

/// Required sections (must be present with non-empty content).
const REQUIRED_SECTIONS: &[&str] = &[SECTION_PERSONALITY, SECTION_OPENING_MESSAGES];

/// Optional but recognized sections. Description is not here — it is an inbound
/// label alias that folds into Personality.
const OPTIONAL_SECTIONS: &[&str] = &[SECTION_SCENARIO, SECTION_EXAMPLE_MESSAGES];

/// Permanent (Scenario+Personality) sweet-spot lower bound. Below this is
/// under-specified. Bands mirror `card_budget.ts`.
const PERMANENT_SWEET_MIN: usize = 2000;
/// Permanent sweet-spot upper bound (2k-3k is the only clean band).
const PERMANENT_SWEET_MAX: usize = 3000;
/// Permanent above the sweet spot but still acceptable if genuinely lorepacked.
const PERMANENT_LOREPACKED_MAX: usize = 6000;
/// Permanent at/above this is bloated territory.
const PERMANENT_BLOATED_MIN: usize = 7000;
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
        (SECTION_PERSONALITY, "Personality"),
        (SECTION_OPENING_MESSAGES, "Opening Messages"),
        (SECTION_SCENARIO, "Scenario"),
        (SECTION_EXAMPLE_MESSAGES, "Example Dialogue"),
    ]
}

/// A header line matched by the (forgiving) section parser.
struct HeaderMatch {
    /// The header label text (e.g. "Opening Messages").
    header: String,
    /// Content that appeared after the header on the same line (the `Label: x`
    /// form), to be treated as the section's first body line.
    inline_body: Option<String>,
}

/// Map a label to its canonical section header, accepting the canonical names
/// and the SillyTavern/Janitor field synonyms (`first_mes`, `mes_example`, ...).
fn canonical_label(label: &str) -> Option<&'static str> {
    object_key_to_header(&normalise_header(label))
}

/// Strip a fully emphasis-wrapped line (`**x**`, `__x__`, `*x*`, `_x_`),
/// returning the inner text when the whole line is wrapped.
fn strip_emphasis(line: &str) -> Option<&str> {
    for marker in ["**", "__", "*", "_"] {
        if let Some(inner) = line
            .strip_prefix(marker)
            .and_then(|rest| rest.strip_suffix(marker))
        {
            let inner = inner.trim();
            if !inner.is_empty() {
                return Some(inner);
            }
        }
    }
    None
}

/// Recognise a section header line.
///
/// The canonical form is an ATX header (`# Name`). To stop the model from
/// looping on layout when it reaches for a different style, the parser also
/// recovers two common variants for *known* section labels: an emphasis-wrapped
/// label (`**Name**`) and a `Label:` line (`Name: Aria`). Recovery is limited to
/// known labels so ordinary prose (e.g. `{{char}}: hi`) is not mistaken for a
/// header.
fn match_header(line: &str) -> Option<HeaderMatch> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // ATX headers: any run of leading '#'. Unrestricted — unknown `# Foo`
    // headers are still parsed and reported as warnings downstream.
    if trimmed.starts_with('#') {
        let header = trimmed.trim_start_matches('#').trim().to_string();
        if header.is_empty() {
            return None;
        }
        return Some(HeaderMatch {
            header,
            inline_body: None,
        });
    }

    // Emphasis-wrapped known label on its own line: **Name**, __Personality__.
    if let Some(inner) = strip_emphasis(trimmed) {
        let label = inner.trim_end_matches(':').trim();
        if let Some(canonical) = canonical_label(label) {
            return Some(HeaderMatch {
                header: canonical.to_string(),
                inline_body: None,
            });
        }
    }

    // `Label:` form, where the text before the first colon is exactly a known
    // section label. Content after the colon becomes the section's first body
    // line.
    if let Some((label, rest)) = trimmed.split_once(':') {
        let label = strip_emphasis(label.trim()).unwrap_or(label).trim();
        if let Some(canonical) = canonical_label(label) {
            let inline = rest.trim();
            let inline_body = (!inline.is_empty()).then(|| inline.to_string());
            return Some(HeaderMatch {
                header: canonical.to_string(),
                inline_body,
            });
        }
    }

    None
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
        if let Some(matched) = match_header(line) {
            // Flush previous section
            if let Some(header) = current_header.take() {
                let raw_body = current_lines.join("\n");
                let body = clean_section_body(&raw_body);
                let section = build_section(&header, &body, &known);
                sections.push(section);
                current_lines.clear();
            }
            // Start new section
            current_header = Some(matched.header);
            if let Some(inline) = matched.inline_body {
                current_lines.push(inline);
            }
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

    merge_duplicate_slugs(sections)
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

    let body_lines: Vec<&str> = lines[start..end].iter().map(|l| l.trim_end()).collect();
    body_lines.join("\n").trim().to_string()
}

/// Map a canonical header label (as produced by [`object_key_to_header`]) back
/// to its section slug.
fn header_label_to_slug(label: &str) -> &'static str {
    match label {
        "Personality" => SECTION_PERSONALITY,
        "Scenario" => SECTION_SCENARIO,
        "Opening Messages" => SECTION_OPENING_MESSAGES,
        "Example Dialogue" => SECTION_EXAMPLE_MESSAGES,
        _ => "",
    }
}

/// Build a CardSection from a header and cleaned body. Folds inbound aliases
/// (e.g. `# Description` → Personality, `mes_example` → Example Dialogue) to
/// their canonical slug before deciding whether the section is recognised.
fn build_section(header: &str, body: &str, known: &[(String, &str)]) -> CardSection {
    let raw_slug = normalise_header(header);
    // Fold aliases/synonyms to the canonical slug. Unknown headers keep their
    // raw slug and stay unrecognised.
    let slug = match object_key_to_header(&raw_slug) {
        Some(label) => header_label_to_slug(label).to_string(),
        None => raw_slug,
    };
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

/// Coalesce multiple sections that share a slug into one, concatenating their
/// bodies in document order (blank-line join). This honours the four-box merge
/// rule: a card with both `# Description` and `# Personality` becomes a single
/// Personality section whose tokens are all counted. Opening Messages are
/// re-split after the merge. Unrecognised sections are left as-is (a `# Name`
/// and a `# Notes` block should each still warn independently).
fn merge_duplicate_slugs(sections: Vec<CardSection>) -> Vec<CardSection> {
    let mut out: Vec<CardSection> = Vec::new();
    for section in sections {
        if !section.recognised {
            out.push(section);
            continue;
        }
        if let Some(existing) = out
            .iter_mut()
            .find(|e| e.recognised && e.slug == section.slug)
        {
            if !section.body.is_empty() {
                if existing.body.is_empty() {
                    existing.body = section.body;
                } else {
                    existing.body.push_str("\n\n");
                    existing.body.push_str(&section.body);
                }
            }
            if existing.slug == SECTION_OPENING_MESSAGES {
                existing.messages = split_opening_messages(&existing.body);
            }
        } else {
            out.push(section);
        }
    }
    out
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
    let section_map: std::collections::HashMap<String, &CardSection> =
        sections.iter().map(|s| (s.slug.clone(), s)).collect();

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
        if !section_map.contains_key(*slug)
            || section_map.get(*slug).is_none_or(|s| s.body.is_empty())
        {
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

/// Strict wrapper around [`validate_card`]: returns `Err` when the card is
/// structurally invalid, so the agent loop surfaces the result as a tool error
/// (`is_error = true`) instead of an easily-ignored success payload. This stops
/// the model from reading past a `valid: false` report and telling the user the
/// card is finished.
pub fn validate_card_strict(input: &Value) -> Result<String, String> {
    let report = validate_card(input)?;
    let parsed: Value = serde_json::from_str(&report).map_err(|error| error.to_string())?;
    if parsed.get("valid").and_then(Value::as_bool) != Some(true) {
        return Err(format!(
            "card is INVALID — it does not meet the Janitor card schema, so you have NOT \
             produced a finished card. Do not tell the user the card is done. Fix every error \
             listed below and re-run validate_card until `valid` is true.\n{report}"
        ));
    }
    Ok(report)
}

/// Extract the card's Markdown text from a tool input.
///
/// Accepts every shape the tool schema advertises:
/// - a Markdown string (`"# Name\n..."`), with or without a `card` wrapper;
/// - a structured object under `card` (`{"card": {"name": ..., "personality":
///   ...}}`), which is assembled into Markdown;
/// - the same fields at the top level (no `card` wrapper).
fn extract_text_input(input: &Value) -> Result<String, String> {
    // Unwrap a `card` wrapper if present; otherwise treat the input itself as
    // the card payload (supports fields at the top level).
    let payload = input.get("card").unwrap_or(input);

    // Markdown string form (the parser's native format).
    if let Some(text) = payload.as_str() {
        return Ok(text.to_string());
    }

    // Structured object form (the shape the tool schema declares): assemble
    // Markdown from recognised fields.
    if let Some(obj) = payload.as_object() {
        if let Some(text) = assemble_markdown_from_object(obj) {
            return Ok(text);
        }
        return Err(
            "`card` object had no recognised fields. Provide one or more of: \
             personality (or description), scenario, first_mes (opening messages), \
             mes_example (example dialogue) — or pass the card as a single Markdown \
             string with `# Section` headers."
                .to_string(),
        );
    }

    Err(
        "`card` must be either a Markdown string (with `# Scenario`, `# Personality`, \
         `# Opening Messages`, `# Example Dialogue` sections) or a JSON object with \
         card fields (personality, scenario, first_mes, mes_example)."
            .to_string(),
    )
}

/// Map a structured object field name (already slug-normalised) to its canonical
/// card section header. Accepts both the SillyTavern/Janitor field names exposed
/// by the tool schema (`first_mes`, `mes_example`) and the Markdown section slugs
/// (`opening_messages`, `example_messages`). Returns `None` for fields with no
/// card section (e.g. `tags`).
fn object_key_to_header(slug: &str) -> Option<&'static str> {
    match slug {
        // Description is an alias/label for the Personality box (four-box model).
        "personality" | "description" => Some("Personality"),
        "scenario" => Some("Scenario"),
        "first_mes" | "opening_messages" | "opening_message" => Some("Opening Messages"),
        "mes_example" | "example_messages" | "example_message" | "example_dialogue" => {
            Some("Example Dialogue")
        }
        // Name is no longer a card field: ignore it entirely.
        "name" => None,
        _ => None,
    }
}

/// Canonical section order for assembled Markdown (the four boxes).
const ASSEMBLY_ORDER: &[&str] = &[
    "Scenario",
    "Personality",
    "Opening Messages",
    "Example Dialogue",
];

/// Render a single field value to body text. Strings pass through; arrays are
/// joined — Opening Messages elements become separate messages (`---` between),
/// everything else joins by newline.
fn render_field_value(header: &str, value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => {
            let parts: Vec<String> = items
                .iter()
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
                .filter(|p| !p.trim().is_empty())
                .collect();
            if header == "Opening Messages" {
                parts.join("\n\n---\n\n")
            } else {
                parts.join("\n")
            }
        }
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Assemble Markdown card text from a structured field object. Returns `None`
/// when no recognised, non-empty fields are present.
fn assemble_markdown_from_object(obj: &serde_json::Map<String, Value>) -> Option<String> {
    let mut by_header: std::collections::HashMap<&'static str, String> =
        std::collections::HashMap::new();
    for (key, value) in obj {
        let Some(header) = object_key_to_header(&normalise_header(key)) else {
            continue;
        };
        let rendered = render_field_value(header, value);
        if rendered.trim().is_empty() {
            continue;
        }
        // Both `description` and `personality` map to header "Personality"; if a
        // structured object supplies both, concatenate rather than overwrite so
        // no permanent tokens are silently dropped (mirrors the Markdown-path
        // merge in parse_sections).
        by_header
            .entry(header)
            .and_modify(|existing| {
                existing.push_str("\n\n");
                existing.push_str(&rendered);
            })
            .or_insert(rendered);
    }
    if by_header.is_empty() {
        return None;
    }
    let blocks: Vec<String> = ASSEMBLY_ORDER
        .iter()
        .filter_map(|h| by_header.get(h).map(|body| format!("# {h}\n{body}")))
        .collect();
    Some(blocks.join("\n\n---\n\n"))
}

/// Double-brace macro names Janitor recognises (mirrors `card_macro_check.ts`:
/// `{{user}}`, `{{char}}`, and the pronoun case set). Single-brace `{user}` /
/// `{char}` are a documented valid style and are not flagged.
const KNOWN_DOUBLE_BRACE: &[&str] = &["user", "char", "sub", "obj", "poss", "ref"];

fn check_placeholders(text: &str, warnings: &mut Vec<String>) {
    // Scan every `{{...}}` occurrence once, classifying spaced vs tight.
    let mut rest = text;
    while let Some(open) = rest.find("{{") {
        let after = &rest[open + 2..];
        if let Some(close) = after.find("}}") {
            let inner = &after[..close];
            let trimmed = inner.trim();
            // Rule 1: spaced double-brace, e.g. `{{ user }}` — not substituted.
            if !trimmed.is_empty() && (inner != trimmed) {
                warnings.push(
                    "spaced placeholder — Janitor only substitutes tight `{{name}}` with no internal spaces"
                        .to_string(),
                );
            } else if !trimmed.is_empty()
                && trimmed.chars().all(|c| c.is_ascii_alphabetic() || c == '_')
                && !KNOWN_DOUBLE_BRACE.contains(&trimmed)
            {
                // Rule 2: tight double-brace with an unknown name.
                warnings.push(format!(
                    "unknown placeholder `{{{{{trimmed}}}}}` — Janitor recognises {{{{user}}}}, {{{{char}}}}, {{{{sub}}}}, {{{{obj}}}}, {{{{poss}}}}, {{{{ref}}}}"
                ));
            }
            rest = &after[close + 2..];
        } else {
            break;
        }
    }

    // Rule 4: {{user}}/{user} used somewhere AND the literal "the user" prose
    // present — a functional bug (that prose won't substitute at runtime).
    let uses_user_macro = text.contains("{{user}}") || text.contains("{user}");
    let collapses_to_prose = contains_ignore_ascii_case(text, "the user");
    if uses_user_macro && collapses_to_prose {
        warnings.push(
            "uses the {{user}}/{user} macro elsewhere but also spells out \"the user\" as literal prose — this is a functional bug (that text will not get substituted at runtime), not just a style nit"
                .to_string(),
        );
    }
}

/// Case-insensitive (ASCII) substring test for a lowercase needle.
fn contains_ignore_ascii_case(haystack: &str, needle_lower: &str) -> bool {
    haystack.to_ascii_lowercase().contains(needle_lower)
}

/// Classify the permanent (Scenario+Personality) token total into one of the
/// five bands from `card_budget.ts`. Returns the band name and an optional flag
/// string; the sweet spot (2k-3k) is the only band with no flag.
fn permanent_band(tokens: usize) -> (&'static str, Option<String>) {
    if tokens < PERMANENT_SWEET_MIN {
        (
            "under_specified",
            Some(format!(
                "permanent definition (Scenario+Personality) is ~{tokens} tokens — under the 2k-3k sweet spot, usually means the card is under-specified"
            )),
        )
    } else if tokens <= PERMANENT_SWEET_MAX {
        ("sweet_spot", None)
    } else if tokens <= PERMANENT_LOREPACKED_MAX {
        (
            "lorepacked_range",
            Some(format!(
                "permanent definition is ~{tokens} tokens — above the 2k-3k sweet spot; fine if genuinely lorepacked (dense, non-redundant), otherwise trim or move situational lore to a lorebook"
            )),
        )
    } else if tokens < PERMANENT_BLOATED_MIN {
        (
            "approaching_bloat",
            Some(format!(
                "permanent definition is ~{tokens} tokens — past the healthy band (especially past 6k); consider proposing a lorebook to offload reference lore"
            )),
        )
    } else {
        (
            "bloated",
            Some(format!(
                "permanent definition is ~{tokens} tokens — bloated territory (7k+); look for repetition or generic filler, and propose a lorebook for reference lore"
            )),
        )
    }
}

/// `token_budget_check`: estimate per-section tokens and flag sections/totals
/// that exceed Janitor's practical context budget. Returns a JSON report string.
pub fn token_budget_check(input: &Value) -> Result<String, String> {
    let text = extract_text_input(input)?;
    let sections = parse_sections(&text);
    let section_map: std::collections::HashMap<String, &CardSection> =
        sections.iter().map(|s| (s.slug.clone(), s)).collect();

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

    // Permanent (always-injected) definition = Scenario + Personality only.
    // Example Dialogue loads once and rolls off like chat history; only 1 of up
    // to 10 Opening Messages loads. Neither counts toward the permanent budget.
    let permanent = personality_tokens + scenario_tokens;

    let mut flags: Vec<String> = Vec::new();

    if personality_tokens == 0 {
        // 0 tokens almost always means the parser found no `# Personality`
        // section, not that the content is short. Say so explicitly so the
        // result is not misread as a token count for present-but-tiny content.
        flags.push(
            "personality section is empty or was not found (0 tokens). The parser saw no \
             content under a `# Personality` header — confirm the header exists and is spelled \
             correctly before judging the size."
                .to_string(),
        );
    }

    // Five-band model on the permanent (Scenario+Personality) total. Skip the
    // band flag when the whole permanent budget is empty — the not-found flag
    // above is the actionable one in that case (avoids a confusing double flag).
    let band = if permanent == 0 {
        "under_specified"
    } else {
        let (band, flag) = permanent_band(permanent);
        if let Some(flag) = flag {
            flags.push(flag);
        }
        band
    };

    let within_budget = flags.is_empty();
    let report = json!({
        "within_budget": within_budget,
        "estimate_method": "approx chars/4 (not a model tokenizer)",
        "per_section_tokens": {
            "personality": personality_tokens,
            "scenario": scenario_tokens,
            "example_messages": example_tokens,
            "opening_messages": opening_tokens,
        },
        "permanent_tokens": permanent,
        "permanent_band": band,
        "limits": {
            "permanent_sweet_min": PERMANENT_SWEET_MIN,
            "permanent_sweet_max": PERMANENT_SWEET_MAX,
            "permanent_lorepacked_max": PERMANENT_LOREPACKED_MAX,
            "permanent_bloated_min": PERMANENT_BLOATED_MIN,
        },
        "flags": flags,
    });
    Ok(report.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // A card in the four-box model: Scenario, Personality, Opening Messages,
    // Example Dialogue. No `# Name`, no `# Description` box.
    fn good_card_text() -> &'static str {
        "# Scenario
{{user}} meets {{char}} at a quiet cafe tucked behind the library.

---

# Personality
{{char}} is warm and witty. {{char}} speaks with a gentle cadence and often
uses dry humour.

---

# Opening Messages
Hi {{user}}, fancy seeing you here!

---

The door chimes softly as {{user}} enters. {{char}} looks up and smiles.

---

# Example Dialogue
{{char}}: Tea? Earl Grey, your favourite.
{{user}}: You remembered.
{{char}}: (a soft laugh) I remember everything about you."
    }

    fn minimal_good_card() -> &'static str {
        "# Personality
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
    fn missing_personality_fails() {
        let text = "# Scenario
A cafe.

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        assert!(v["errors"].as_array().unwrap().iter().any(|e| e
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("personality")));
    }

    #[test]
    fn missing_opening_messages_fails() {
        let text = "# Personality
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
        let mut body = "# Personality
p

---

# Opening Messages
msg1"
            .to_string();
        for i in 2..=12 {
            body.push_str(&format!("\n\n---\n\nmsg{i}"));
        }
        let input = json!({ "card": body });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(false));
        assert!(v["errors"].as_array().unwrap().iter().any(|e| e
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("max")));
    }

    #[test]
    fn empty_opening_messages_fails() {
        let text = "# Personality
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
        let text = "# Personality
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
    fn macro_pronoun_set_not_flagged() {
        // The pronoun case-macro set is valid and must NOT warn "unknown".
        let text = "# Personality
{{char}} adjusts {{poss}} coat. Ask {{sub}} anything; {{obj}} will answer for {{ref}}.

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(
            !v["warnings"]
                .as_array()
                .unwrap()
                .iter()
                .any(|w| w.as_str().unwrap().contains("unknown placeholder")),
            "pronoun macros must not be flagged: {out}"
        );
    }

    #[test]
    fn single_brace_user_char_valid() {
        // Single-brace {user}/{char} is a documented valid style — no warning.
        let text = "# Personality
{char} is calm and greets {user} warmly.

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(
            !v["warnings"]
                .as_array()
                .unwrap()
                .iter()
                .any(|w| w.as_str().unwrap().contains("placeholder")),
            "single-brace macros must not be flagged: {out}"
        );
    }

    #[test]
    fn user_collapse_flag() {
        // {{user}} used AND literal "the user" prose present => functional bug.
        let text = "# Personality
{{char}} watches the user closely, then greets {{user}} by name.

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(
            v["warnings"].as_array().unwrap().iter().any(|w| {
                let s = w.as_str().unwrap();
                s.contains("the user") || s.contains("functional bug")
            }),
            "expected user-collapse warning: {out}"
        );
    }

    #[test]
    fn name_block_is_unrecognized_not_required() {
        // A `# Name` block no longer errors — it parses as a harmless
        // unrecognised section, and the card is still valid.
        let text = "# Name
Aria

---

# Personality
{{char}} is warm.

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert!(
            v["warnings"].as_array().unwrap().iter().any(|w| {
                let s = w.as_str().unwrap();
                s.contains("unrecognised") && s.contains("Name")
            }),
            "expected unrecognised Name warning: {out}"
        );
    }

    #[test]
    fn token_budget_flags_approaching_bloat() {
        let big = "word ".repeat(5000); // ~6250 est tokens => approaching_bloat
        let text = format!(
            "# Personality
{big}

---

# Opening Messages
hi"
        );
        let input = json!({ "card": text });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["within_budget"], json!(false));
        assert_eq!(
            v["permanent_band"],
            json!("approaching_bloat"),
            "report: {out}"
        );
        assert!(v["flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f.as_str().unwrap().contains("past the healthy band")));
    }

    #[test]
    fn token_budget_flags_bloated() {
        let big = "word ".repeat(6000); // ~7500 est tokens => bloated
        let text = format!(
            "# Personality
{big}

---

# Opening Messages
hi"
        );
        let input = json!({ "card": text });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["within_budget"], json!(false));
        assert_eq!(v["permanent_band"], json!("bloated"), "report: {out}");
        assert!(v["flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f.as_str().unwrap().contains("bloated")));
    }

    #[test]
    fn token_budget_flags_under_specified_small_card() {
        let input = json!({ "card": good_card_text() });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        // A tiny card is under-specified (below the 2k-3k sweet spot).
        assert_eq!(v["within_budget"], json!(false), "report: {out}");
        assert!(v["flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f.as_str().unwrap().contains("under-specified")));
    }

    #[test]
    fn token_budget_sweet_spot_passes() {
        // Personality tuned to land in the 2k-3k sweet spot.
        // ceil(chars/4) tokens; "This character has a detailed inner world. "
        // is 43 chars => ~250 reps ~= 10750 chars ~= 2688 tokens.
        let sweet = "This character has a detailed inner world. ".repeat(250);
        let text = format!(
            "# Personality
{sweet}

---

# Opening Messages
Hello there."
        );
        let input = json!({ "card": text });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["permanent_band"], json!("sweet_spot"), "report: {out}");
        assert_eq!(v["within_budget"], json!(true), "report: {out}");
    }

    #[test]
    fn example_dialogue_excluded_from_permanent() {
        // A large Example Dialogue plus a sweet-spot Personality stays within
        // budget — Example Dialogue does not count toward the permanent total.
        let sweet = "This character has a detailed inner world. ".repeat(250);
        let big_example = "word ".repeat(3000); // ~3750 tokens, excluded
        let text = format!(
            "# Personality
{sweet}

---

# Opening Messages
Hello there.

---

# Example Dialogue
{big_example}"
        );
        let input = json!({ "card": text });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(
            v["per_section_tokens"]["example_messages"]
                .as_u64()
                .unwrap()
                > 0
        );
        assert_eq!(v["within_budget"], json!(true), "report: {out}");
    }

    #[test]
    fn description_folds_into_personality() {
        // A card whose ONLY permanent box is `# Description` still validates:
        // Description folds into Personality.
        let text = "# Description
{{char}} is a stoic ex-soldier who rarely speaks about the past.

---

# Opening Messages
{{char}} nods once, saying nothing.";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert!(v["sections_present"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s == "personality"));
    }

    #[test]
    fn description_tokens_count_as_personality() {
        // The Description body's tokens land in per_section_tokens.personality
        // and count toward the permanent total.
        let desc = "This character has a detailed inner world. ".repeat(250);
        let text = format!(
            "# Description
{desc}

---

# Opening Messages
Hi."
        );
        let out = token_budget_check(&json!({ "card": text })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let ptok = v["per_section_tokens"]["personality"].as_u64().unwrap();
        assert!(
            ptok > 2000,
            "description should count as personality: {out}"
        );
        assert_eq!(v["permanent_tokens"].as_u64().unwrap(), ptok);
    }

    #[test]
    fn estimate_is_ceil_div_4() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn parse_sections_smoke_test() {
        let text = "# Personality
Smart.

---

# Opening Messages
Hi!";
        let sections = parse_sections(text);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].slug, "personality");
        assert_eq!(sections[1].slug, "opening_messages");
    }

    #[test]
    fn direct_string_input_works() {
        let text = "# Personality
p

---

# Opening Messages
hi";
        let out = validate_card(&Value::String(text.to_string())).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true));
    }

    #[test]
    fn structured_object_card_validates() {
        // The shape the tool schema advertises: a JSON object under `card`,
        // using the SillyTavern field names. `name` is ignored; `description`
        // folds into personality.
        let input = json!({
            "card": {
                "name": "Akira",
                "description": "A kuudere childhood friend.",
                "personality": "{{char}} is cold on the surface but deeply caring.",
                "scenario": "{{user}} transfers into {{char}}'s class.",
                "first_mes": "{{char}} glances up, expression unreadable.",
                "mes_example": "{{char}}: ...Hello."
            }
        });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert_eq!(v["errors"].as_array().unwrap().len(), 0);
        assert!(v["sections_present"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s == "personality"));
    }

    #[test]
    fn structured_fields_at_top_level_validate() {
        // Same fields without the `card` wrapper. `name` is ignored.
        let input = json!({
            "name": "Akira",
            "personality": "{{char}} keeps everyone at arm's length.",
            "first_mes": "{{char}} says nothing."
        });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
    }

    #[test]
    fn structured_opening_messages_array_splits() {
        let input = json!({
            "card": {
                "name": "Akira",
                "personality": "{{char}} is quiet.",
                "first_mes": ["First opening.", "Second opening."]
            }
        });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert_eq!(v["opening_message_count"], json!(2));
    }

    #[test]
    fn empty_object_card_errors_helpfully() {
        let err = validate_card(&json!({ "card": {} })).unwrap_err();
        assert!(err.contains("recognised fields"), "got: {err}");
    }

    #[test]
    fn colon_style_headers_parse_and_validate() {
        // The model sometimes reaches for `Label:` instead of `# Label`.
        let text = "Personality:
{{char}} is warm and witty and speaks with a gentle cadence.

Opening Messages:
Hi {{user}}, fancy seeing you here!";
        let out = validate_card(&json!({ "card": text })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert_eq!(v["opening_message_count"], json!(1));
    }

    #[test]
    fn bold_headers_parse_and_validate() {
        let text = "**Personality**
{{char}} is a quiet observer who speaks in short sentences.

**Opening Messages**
The stars are out tonight.";
        let out = validate_card(&json!({ "card": text })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
    }

    #[test]
    fn synonym_colon_header_maps_to_canonical_section() {
        // `first_mes:` must be recognised as the Opening Messages section, not
        // an unrecognised section.
        let text = "# Personality
{{char}} keeps everyone at arm's length.

first_mes:
{{char}} glances up, expression unreadable.";
        let out = validate_card(&json!({ "card": text })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        assert_eq!(v["opening_message_count"], json!(1));
        assert!(v["sections_present"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s == "opening_messages"));
    }

    #[test]
    fn prose_colon_lines_are_not_headers() {
        // Lines like `{{char}}: ...` use unknown labels and must stay body text,
        // not split the section.
        let text = "# Personality
{{char}} is warm.

# Opening Messages
{{char}}: Hello there, {{user}}.
{{user}}: Hi!
{{char}}: How are you today?";
        let out = validate_card(&json!({ "card": text })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true), "report: {out}");
        // All three colon lines are one opening message (no `---` separators).
        assert_eq!(v["opening_message_count"], json!(1));
    }

    #[test]
    fn validate_card_strict_errors_on_invalid() {
        // Missing required Opening Messages section => invalid under new rules.
        let text = "# Personality
p";
        let err = validate_card_strict(&json!({ "card": text })).unwrap_err();
        assert!(err.contains("INVALID"), "got: {err}");
        // The full report is still attached for the model to act on.
        assert!(err.contains("\"valid\":false"), "got: {err}");
    }

    #[test]
    fn validate_card_strict_ok_on_valid() {
        let out = validate_card_strict(&json!({ "card": minimal_good_card() })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true));
    }

    #[test]
    fn token_budget_zero_personality_explains_not_found() {
        // Misspelled header => personality parsed as 0 tokens. The flag should
        // explain "not found", not just call it low quality.
        let text = "# Persanality
{{char}} is warm.

# Opening Messages
hi";
        let out = token_budget_check(&json!({ "card": text })).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["per_section_tokens"]["personality"], json!(0));
        assert!(v["flags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f.as_str().unwrap().contains("not found")));
    }

    #[test]
    fn token_budget_accepts_structured_object() {
        // token_budget_check shares extract_text_input, so it must accept the
        // structured object form too.
        let big = "This character has rich, layered motivations. ".repeat(120);
        let input = json!({
            "card": { "name": "Akira", "personality": big, "first_mes": "hi" }
        });
        let out = token_budget_check(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["per_section_tokens"]["personality"].as_u64().unwrap() > 1000);
    }

    #[test]
    fn opening_messages_count_matches() {
        let text = "# Personality
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
    fn scenario_and_example_messages_optional() {
        // No Scenario or Example Dialogue — should only warn, not error.
        let text = "# Personality
p

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true));
        // Should warn about missing scenario and example dialogue.
        let warnings = v["warnings"].as_array().unwrap();
        assert!(!warnings.is_empty());
        // The stale Description warning must be gone.
        assert!(
            !warnings
                .iter()
                .any(|w| w.as_str().unwrap().contains("Description")),
            "no Description warning expected: {out}"
        );
    }

    #[test]
    fn sections_sorted_in_present() {
        let text = "# Personality
p

---

# Opening Messages
hi";
        let input = json!({ "card": text });
        let out = validate_card(&input).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["valid"], json!(true));
        let present = v["sections_present"].as_array().unwrap();
        // Sorted alphabetically by slug.
        assert_eq!(present[0], json!("opening_messages"));
        assert_eq!(present[1], json!("personality"));
    }

    #[test]
    fn merges_description_and_personality() {
        // Both boxes present => merged into one Personality (tokens summed).
        let text = "# Description
Alpha bravo charlie.

---

# Personality
Delta echo foxtrot.

---

# Opening Messages
hi";
        let sections = parse_sections(text);
        let personality: Vec<_> = sections
            .iter()
            .filter(|s| s.slug == "personality")
            .collect();
        assert_eq!(
            personality.len(),
            1,
            "should merge to one personality section"
        );
        assert!(personality[0].body.contains("Alpha"));
        assert!(personality[0].body.contains("Delta"));
    }
}
