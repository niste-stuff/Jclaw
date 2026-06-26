use std::io::{self, IsTerminal, Write};

use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode};
use runtime::{
    load_oauth_credentials, save_user_provider_settings, ConfigLoader, RuntimeProviderConfig,
};

/// API-key env vars that, when set, mean a usable provider is already
/// configured. Covers Anthropic plus every OpenAI-compatible endpoint the
/// runtime can route to (`OPENAI_*` is also used for custom endpoints).
const CREDENTIAL_ENV_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "DASHSCOPE_API_KEY",
];

const PROVIDERS: &[(&str, &str, &str)] = &[
    ("1", "Anthropic", "anthropic"),
    ("2", "xAI / Grok", "xai"),
    ("3", "OpenAI", "openai"),
    ("4", "DashScope (Qwen/Kimi)", "dashscope"),
    ("5", "Custom (OpenAI-compat)", "openai"),
];

const PROVIDER_MODELS: &[(&str, &[&str])] = &[
    ("anthropic", &["opus", "sonnet", "haiku"]),
    ("xai", &["grok", "grok-mini", "grok-2"]),
    ("openai", &["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"]),
    ("dashscope", &["qwen-plus", "qwen-max", "kimi"]),
];

const DEFAULT_BASE_URLS: &[(&str, &str)] = &[
    ("anthropic", "https://api.anthropic.com"),
    ("xai", "https://api.x.ai/v1"),
    ("openai", "https://api.openai.com/v1"),
    (
        "dashscope",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ),
];

const API_KEY_ENV_VARS: &[(&str, &str)] = &[
    ("anthropic", "ANTHROPIC_API_KEY"),
    ("xai", "XAI_API_KEY"),
    ("openai", "OPENAI_API_KEY"),
    ("dashscope", "DASHSCOPE_API_KEY"),
];

pub fn run_setup_wizard(from_api: bool) -> Result<(), Box<dyn std::error::Error>> {
    if !io::stdin().is_terminal() {
        return Err("setup requires an interactive terminal".into());
    }

    let current = load_current_provider_config();

    let heading = if from_api {
        "Jclaw Config"
    } else {
        "Jclaw Setup Wizard"
    };

    println!();
    println!("  \x1b[1m{heading}\x1b[0m");
    println!("  Configure your provider, API key, and model.");
    println!("  \x1b[2mPress Enter to keep current value · Esc to cancel.\x1b[0m\n");

    let kind = prompt_provider(&current)?;
    let api_key = prompt_api_key(&kind, &current)?;
    let base_url = prompt_base_url(&kind, &current)?;
    let model = prompt_model(&kind, &current)?;
    let model = force_custom_openai_routing(&kind, base_url.as_deref(), model);
    let fast_model = prompt_fast_model(&current, model.as_deref())?;

    save_user_provider_settings(&kind, &api_key, base_url.as_deref(), model.as_deref())?;

    if let Some(fast) = &fast_model {
        save_settings_field("subagentModel", fast)?;
    }

    let activate_model = model.as_deref().unwrap_or(&kind);

    println!();
    println!("  \x1b[32mProvider saved to ~/.claw/settings.json\x1b[0m");
    println!("  Run \x1b[1m/model {activate_model}\x1b[0m or restart claw to activate.");
    if let Some(bare) = activate_model.strip_prefix("local/") {
        println!(
            "  \x1b[2m(`local/` is a routing prefix, not a local model — it forces your \
             custom endpoint and is stripped before `{bare}` is sent.)\x1b[0m"
        );
    }
    println!();

    Ok(())
}

fn load_current_provider_config() -> RuntimeProviderConfig {
    let cwd = std::env::current_dir().unwrap_or_default();
    ConfigLoader::default_for(&cwd)
        .load()
        .map(|c| c.provider().clone())
        .unwrap_or_default()
}

fn prompt_provider(current: &RuntimeProviderConfig) -> Result<String, Box<dyn std::error::Error>> {
    let current_index = current_provider_index(current);
    let options: Vec<String> = PROVIDERS
        .iter()
        .enumerate()
        .map(|(i, (_, label, _))| {
            if Some(i) == current_index {
                format!("{label} (current)")
            } else {
                (*label).to_string()
            }
        })
        .collect();

    let choice =
        select_menu("Provider", &options, current_index.unwrap_or(0))?.ok_or("setup cancelled")?;
    Ok(PROVIDERS[choice].2.to_string())
}

/// Resolve which `PROVIDERS` row matches the current config. Two rows share the
/// `openai` kind (the branded OpenAI endpoint and the generic
/// `Custom (OpenAI-compat)` row), so a plain kind match would tag both as
/// `(current)`. Disambiguate the OpenAI-compatible rows by base URL: only the
/// built-in `api.openai.com` endpoint counts as branded OpenAI; anything else
/// (or a non-default URL) is the custom row.
fn current_provider_index(current: &RuntimeProviderConfig) -> Option<usize> {
    let current_kind = current.kind().unwrap_or("anthropic");

    if current_kind == "openai" {
        let openai_default = DEFAULT_BASE_URLS
            .iter()
            .find(|(k, _)| *k == "openai")
            .map_or("", |(_, v)| *v);
        let base = current.base_url().unwrap_or("");
        let is_branded_openai = base.is_empty() || base == openai_default;
        let target_label = if is_branded_openai {
            "OpenAI"
        } else {
            "Custom (OpenAI-compat)"
        };
        return PROVIDERS
            .iter()
            .position(|(_, label, _)| *label == target_label);
    }

    PROVIDERS
        .iter()
        .position(|(_, _, kind)| *kind == current_kind)
}

fn prompt_api_key(
    kind: &str,
    current: &RuntimeProviderConfig,
) -> Result<String, Box<dyn std::error::Error>> {
    let env_var = API_KEY_ENV_VARS
        .iter()
        .find(|(k, _)| *k == kind)
        .map_or("API_KEY", |(_, v)| *v);

    let current_key = current.api_key();
    let hint = match current_key {
        Some(key) if !key.is_empty() => {
            let masked = if key.len() > 4 {
                format!("****{}", &key[key.len() - 4..])
            } else {
                "****".to_string()
            };
            format!("[{masked}]")
        }
        _ => "(none)".to_string(),
    };

    // Check if env var is already set
    let env_set = std::env::var(env_var).ok().is_some_and(|v| !v.is_empty());
    if env_set {
        println!("  {env_var} is set in environment (will take priority over stored key)");
    }

    let input = read_line(&format!("  API key ({env_var}) {hint}: "))?;
    let key = if input.trim().is_empty() {
        current_key.unwrap_or("").to_string()
    } else {
        input.trim().to_string()
    };

    if key.is_empty() && !env_set {
        eprintln!(
            "  \x1b[33mWarning: no API key configured. Set {env_var} or re-run setup.\x1b[0m"
        );
    }

    Ok(key)
}

fn prompt_base_url(
    kind: &str,
    current: &RuntimeProviderConfig,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let default_url = DEFAULT_BASE_URLS
        .iter()
        .find(|(k, _)| *k == kind)
        .map_or("", |(_, v)| *v);

    let current_url = current.base_url().unwrap_or(default_url);
    let display = if current_url.is_empty() {
        default_url.to_string()
    } else {
        current_url.to_string()
    };

    // Check if the relevant env var is already set
    let env_var = match kind {
        "anthropic" => "ANTHROPIC_BASE_URL",
        "xai" => "XAI_BASE_URL",
        "openai" => "OPENAI_BASE_URL",
        "dashscope" => "DASHSCOPE_BASE_URL",
        _ => "BASE_URL",
    };
    let env_set = std::env::var(env_var).ok().is_some_and(|v| !v.is_empty());
    if env_set {
        println!("  {env_var} is set in environment (will take priority over stored URL)");
    }

    let input = read_line(&format!("  Base URL [{display}]: "))?;
    if input.trim().is_empty() {
        if current_url == default_url || current_url.is_empty() {
            Ok(None)
        } else {
            Ok(Some(current_url.to_string()))
        }
    } else {
        Ok(Some(input.trim().to_string()))
    }
}

fn prompt_model(
    kind: &str,
    current: &RuntimeProviderConfig,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let empty: &[&str] = &[];
    let aliases = PROVIDER_MODELS
        .iter()
        .find(|(k, _)| *k == kind)
        .map_or(empty, |(_, models)| *models);

    let current_model = current
        .model()
        .unwrap_or(aliases.first().copied().unwrap_or(""));

    // Offer the common models as an arrow-selectable list, with a final
    // "custom" row that drops to free-text entry (e.g. `openai/gpt-4.1-mini`
    // for prefix-based routing to a custom OpenAI-compatible endpoint).
    let mut options: Vec<String> = aliases.iter().map(|model| (*model).to_string()).collect();
    let custom_index = options.len();
    options.push("Custom (type a model name)".to_string());

    let default = aliases
        .iter()
        .position(|model| *model == current_model)
        .unwrap_or(custom_index);

    let choice = select_menu("Model", &options, default)?.ok_or("setup cancelled")?;
    if choice != custom_index {
        return Ok(Some(options[choice].clone()));
    }

    let input = read_line(&format!("  Model [{current_model}]: "))?;
    if input.trim().is_empty() {
        if current_model.is_empty() {
            Ok(None)
        } else {
            Ok(Some(current_model.to_string()))
        }
    } else {
        Ok(Some(input.trim().to_string()))
    }
}

fn prompt_fast_model(
    current: &RuntimeProviderConfig,
    main_model: Option<&str>,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    println!();
    println!("  \x1b[1mFast Model (for Agent subtasks)\x1b[0m");
    println!("    A smaller/cheaper model used by the Agent tool when spawning");
    println!("    Explore, Plan, or Verification sub-agents. This saves tokens");
    println!("    by using a fast model for information-gathering tasks.");
    println!("    Press Enter to skip (agents will use your main model).");

    let current_fast = load_current_settings_field("subagentModel");
    let default_hint = current_fast.as_deref().or(main_model).unwrap_or("");

    let input = read_line(&format!(
        "  Fast model [{}]: ",
        if default_hint.is_empty() {
            "same as main"
        } else {
            default_hint
        }
    ))?;
    if input.trim().is_empty() {
        Ok(current_fast)
    } else {
        Ok(Some(input.trim().to_string()))
    }
}

fn load_current_settings_field(field: &str) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let settings_path = std::path::Path::new(&home).join(".claw/settings.json");
    let content = std::fs::read_to_string(&settings_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get(field)?.as_str().map(|s| s.to_string())
}

fn save_settings_field(field: &str, value: &str) -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    let settings_dir = std::path::Path::new(&home).join(".claw");
    let settings_path = settings_dir.join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content)?
    } else {
        serde_json::json!({})
    };

    if let Some(obj) = settings.as_object_mut() {
        obj.insert(
            field.to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }

    std::fs::create_dir_all(&settings_dir)?;
    std::fs::write(&settings_path, serde_json::to_string_pretty(&settings)?)?;
    Ok(())
}

/// Interactive-launch credential gate.
///
/// Bridges any provider settings saved by the wizard into the process
/// environment (the API clients read env vars / `.env`, not `settings.json`),
/// then checks whether *any* supported provider has a usable credential —
/// Anthropic or any OpenAI-compatible endpoint. If none is found and we have
/// an interactive terminal, the setup wizard is launched to collect one.
pub fn ensure_provider_configured() {
    heal_stored_model_routing();
    apply_stored_provider_to_env();
    if has_any_credentials() {
        return;
    }
    if !io::stdin().is_terminal() {
        // Non-interactive (piped/`prompt`): let the normal
        // missing-credentials error surface instead of blocking on a prompt.
        return;
    }

    println!();
    println!("  \x1b[1mNo API credentials detected.\x1b[0m");
    println!("  Set up a provider now — Anthropic or any OpenAI-compatible endpoint.");
    if let Err(error) = run_setup_wizard(false) {
        // Esc/Ctrl-C is a deliberate cancel, not a crash — exit cleanly with a
        // friendly next-step hint instead of falling through to the generic
        // "missing Anthropic credentials" error stack.
        if error.to_string().contains("cancelled") {
            println!();
            println!("  \x1b[2mSetup cancelled.\x1b[0m Jclaw needs a provider to start.");
            println!(
                "  Re-run and finish setup, or set an API key first — e.g. \x1b[1mANTHROPIC_API_KEY\x1b[0m or \x1b[1mOPENAI_API_KEY\x1b[0m."
            );
            std::process::exit(0);
        }
        eprintln!("  Setup wizard failed: {error}");
        return;
    }
    // Apply the just-saved key/URL so this same session can use them.
    apply_stored_provider_to_env();
}

/// Repair a previously-saved config whose model would misroute. Configs
/// written before custom-endpoint routing was handled (or hand-edited ones)
/// can store a bare model like `qwen/qwen3.7-plus` against a custom OpenAI
/// base URL, which the runtime sends to DashScope instead of the configured
/// endpoint. Rewrite such a model with the `local/` prefix so launch succeeds.
/// Idempotent: a model that already routes correctly is left untouched.
fn heal_stored_model_routing() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let Ok(config) = ConfigLoader::default_for(&cwd).load() else {
        return;
    };
    let provider = config.provider();
    let (Some(kind), Some(model)) = (provider.kind(), config.model()) else {
        return;
    };
    let base_url = provider.base_url();
    let corrected = force_custom_openai_routing(kind, base_url, Some(model.to_string()));
    if corrected.as_deref() == Some(model) {
        return;
    }
    let Some(corrected) = corrected else { return };
    // Update only the `model` field rather than calling `save_user_provider_settings`,
    // which would clobber an env-var-only setup with `"apiKey": ""`.
    if let Err(error) = save_settings_field("model", &corrected) {
        eprintln!("  warning: could not auto-fix model routing: {error}");
    }
}

/// For a *custom* OpenAI-compatible endpoint (e.g. OpenRouter, a local
/// gateway), force the model to route to that endpoint by prefixing it with
/// `local/`.
///
/// Why this is needed: the runtime picks a provider from the **model name**,
/// not the configured `kind`. A model id like `qwen/qwen3.7-plus` hard-routes
/// to Alibaba DashScope (reading `DASHSCOPE_API_KEY`) even though the user
/// pointed at OpenRouter — so startup fails with "missing DashScope
/// credentials". The `local/` prefix is the runtime's escape hatch: it forces
/// the OpenAI-compatible client at `OPENAI_BASE_URL` and is stripped before the
/// model id is sent on the wire, so the endpoint still receives the original
/// id. Branded providers (api.openai.com, xAI, DashScope) keep their own
/// prefix-based routing untouched.
fn force_custom_openai_routing(
    kind: &str,
    base_url: Option<&str>,
    model: Option<String>,
) -> Option<String> {
    let model = model?;
    // `base_url` is only `Some` here when the user overrode the default, so a
    // present base URL for the OpenAI kind means a custom endpoint. Models that
    // already carry a forcing prefix are left as-is.
    let is_custom_openai = kind == "openai"
        && base_url.is_some_and(|url| !url.trim().is_empty())
        && !model.starts_with("local/")
        && !model.starts_with("openai/");
    if is_custom_openai {
        Some(format!("local/{model}"))
    } else {
        Some(model)
    }
}

/// Map a stored provider `kind` to its `(api_key_env, base_url_env)` variables.
/// Custom OpenAI-compatible endpoints are stored as `openai`, so they fall
/// through to the `OPENAI_*` vars (with a custom `baseUrl`).
fn provider_env_vars(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "anthropic" => ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"),
        "xai" => ("XAI_API_KEY", "XAI_BASE_URL"),
        "dashscope" => ("DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL"),
        _ => ("OPENAI_API_KEY", "OPENAI_BASE_URL"),
    }
}

/// Copy the stored provider key/base-URL into the environment so the API
/// clients pick them up. A value already present in the environment always
/// wins, so this never overrides an explicit `export`.
pub fn apply_stored_provider_to_env() {
    let cfg = load_current_provider_config();
    let Some(kind) = cfg.kind() else {
        return;
    };
    let (key_var, url_var) = provider_env_vars(kind);
    if let Some(key) = cfg.api_key() {
        if !key.is_empty() && !env_nonempty(key_var) {
            std::env::set_var(key_var, key);
        }
    }
    if let Some(url) = cfg.base_url() {
        if !url.is_empty() && !env_nonempty(url_var) {
            std::env::set_var(url_var, url);
        }
    }
}

/// Whether a usable credential exists for any supported provider: an env var,
/// a matching key in a project `.env`, or a saved subscription (OAuth) login.
fn has_any_credentials() -> bool {
    if CREDENTIAL_ENV_VARS.iter().any(|var| env_nonempty(var)) {
        return true;
    }
    if dotenv_has_credential() {
        return true;
    }
    load_oauth_credentials().ok().flatten().is_some()
}

fn env_nonempty(key: &str) -> bool {
    std::env::var(key).is_ok_and(|value| !value.is_empty())
}

/// Minimal `.env` probe: returns true if the project `.env` assigns a
/// non-empty value to any of the credential env vars. This is detection only
/// (the API clients do the authoritative `.env` parsing), so it tolerates the
/// common `KEY=value` / `export KEY=value` forms and ignores the rest.
fn dotenv_has_credential() -> bool {
    let Ok(cwd) = std::env::current_dir() else {
        return false;
    };
    let Ok(content) = std::fs::read_to_string(cwd.join(".env")) else {
        return false;
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches(['"', '\''].as_ref());
        if !value.is_empty() && CREDENTIAL_ENV_VARS.contains(&key.trim()) {
            return true;
        }
    }
    false
}

/// Restores cooked terminal mode on drop so raw mode can never leak past a
/// menu — even if a write fails or the surrounding code panics mid-selection.
struct RawModeGuard;

impl RawModeGuard {
    fn enter() -> io::Result<Self> {
        enable_raw_mode()?;
        Ok(Self)
    }
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
    }
}

/// Present an arrow-key navigable single-select menu and return the chosen
/// index. `Up`/`Down` (or `k`/`j`) move, a digit jumps to that entry, `Enter`
/// confirms, and `Esc`/`Ctrl-C` cancel (returns `None`). When stdin is not a
/// TTY the menu can't be driven, so the default selection is returned as-is.
fn select_menu(title: &str, options: &[String], default: usize) -> io::Result<Option<usize>> {
    if options.is_empty() {
        return Ok(None);
    }
    let last = options.len() - 1;
    let mut selected = default.min(last);

    if !io::stdin().is_terminal() {
        return Ok(Some(selected));
    }

    let mut stdout = io::stdout();
    println!("  \x1b[1m{title}\x1b[0m");
    println!("  \x1b[2m(\u{2191}/\u{2193} to move \u{00b7} Enter to select)\x1b[0m");
    render_menu(&mut stdout, options, selected)?;
    stdout.flush()?;

    let _raw = RawModeGuard::enter()?;
    loop {
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind == KeyEventKind::Release {
            continue;
        }
        match key.code {
            KeyCode::Up => {
                selected = if selected == 0 { last } else { selected - 1 };
            }
            KeyCode::Down => {
                selected = if selected == last { 0 } else { selected + 1 };
            }
            KeyCode::Char('k') if key.modifiers.is_empty() => {
                selected = if selected == 0 { last } else { selected - 1 };
            }
            KeyCode::Char('j') if key.modifiers.is_empty() => {
                selected = if selected == last { 0 } else { selected + 1 };
            }
            KeyCode::Enter => return Ok(Some(selected)),
            KeyCode::Esc => return Ok(None),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                return Ok(None);
            }
            KeyCode::Char(digit) if digit.is_ascii_digit() => {
                if let Some(index) = digit.to_digit(10).map(|n| n as usize) {
                    if (1..=options.len()).contains(&index) {
                        selected = index - 1;
                    }
                }
            }
            _ => continue,
        }
        // Step the cursor back over the rendered rows and repaint in place.
        write!(stdout, "\x1b[{}A", options.len())?;
        render_menu(&mut stdout, options, selected)?;
        stdout.flush()?;
    }
}

/// Paint one row per option, highlighting the selection. Each row is prefixed
/// with `\r` + clear-line so it repaints cleanly in raw mode, and terminated
/// with `\r\n` (raw mode does not translate a bare `\n` to a newline).
fn render_menu(stdout: &mut impl Write, options: &[String], selected: usize) -> io::Result<()> {
    for (index, option) in options.iter().enumerate() {
        if index == selected {
            write!(stdout, "\r\x1b[2K  \x1b[36m\u{276f} {option}\x1b[0m\r\n")?;
        } else {
            write!(stdout, "\r\x1b[2K    {option}\r\n")?;
        }
    }
    Ok(())
}

fn read_line(prompt: &str) -> Result<String, Box<dyn std::error::Error>> {
    let mut stdout = io::stdout();
    write!(stdout, "{prompt}")?;
    stdout.flush()?;
    let mut buffer = String::new();
    io::stdin().read_line(&mut buffer)?;
    Ok(buffer)
}

/// Permission modes offered by the settings menu: `(menu label, config value
/// written to `permissions.defaultMode`)`. The config values are the canonical
/// strings the runtime accepts (see `parse_permission_mode_label`).
const PERMISSION_MENU_MODES: &[(&str, &str)] = &[
    (
        "Read-only — never writes files or runs commands",
        "read-only",
    ),
    (
        "Workspace-write — edit files here, ask before shell (default)",
        "workspace-write",
    ),
    (
        "Full access — run everything, no prompts (risky)",
        "dontAsk",
    ),
];

/// Interactive settings hub, launched by `--config`. Loops a
/// top-level menu so several settings can be changed in one sitting, then
/// returns. Unlike `ensure_provider_configured`, this runs on demand even when
/// credentials already exist.
pub fn run_config_menu() -> Result<(), Box<dyn std::error::Error>> {
    if !io::stdin().is_terminal() {
        eprintln!("  --config needs an interactive terminal (a TTY).");
        return Ok(());
    }

    apply_stored_provider_to_env();
    println!();
    println!("  \x1b[1mJclaw Settings\x1b[0m");
    println!("  \x1b[2mPick a setting to change · Esc or Done to finish.\x1b[0m");

    let options = vec![
        "API provider, key & model".to_string(),
        "Default permission mode".to_string(),
        "Show current settings".to_string(),
        "Done".to_string(),
    ];

    // Esc returns None and ends the hub; "Done" breaks out from inside.
    while let Some(choice) = select_menu("Settings", &options, 0)? {
        match choice {
            0 => {
                // The provider wizard cancelling (Esc) should drop back to this
                // hub, not abort the whole menu.
                if let Err(error) = run_setup_wizard(true) {
                    if error.to_string().contains("cancelled") {
                        println!("  \x1b[2mProvider setup cancelled — nothing changed.\x1b[0m");
                    } else {
                        return Err(error);
                    }
                }
            }
            1 => prompt_and_save_permission_mode()?,
            2 => print_current_settings(),
            _ => break, // "Done"
        }
        println!();
    }

    println!("  \x1b[2mDone.\x1b[0m");
    Ok(())
}

/// Offer the permission-mode choices and persist the pick to the user
/// `settings.json` as `permissions.defaultMode`. Esc leaves it unchanged.
fn prompt_and_save_permission_mode() -> Result<(), Box<dyn std::error::Error>> {
    let current = read_user_settings_permission_mode();
    let labels: Vec<String> = PERMISSION_MENU_MODES
        .iter()
        .map(|(label, value)| {
            if current.as_deref() == Some(*value) {
                format!("{label}  (current)")
            } else {
                (*label).to_string()
            }
        })
        .collect();
    let default = PERMISSION_MENU_MODES
        .iter()
        .position(|(_, value)| current.as_deref() == Some(*value))
        .unwrap_or(1);

    let Some(choice) = select_menu("Default permission mode", &labels, default)? else {
        return Ok(()); // cancelled
    };
    let value = PERMISSION_MENU_MODES[choice].1;
    save_permission_default_mode(value)?;
    println!("  Default permission mode set to \x1b[1m{value}\x1b[0m for new sessions.");
    Ok(())
}

/// Read `permissions.defaultMode` from the user `settings.json`, if present.
fn read_user_settings_permission_mode() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home)
        .join(".claw")
        .join("settings.json");
    let content = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    extract_permission_default_mode(&value)
}

/// Pure read of `permissions.defaultMode` from a settings value.
fn extract_permission_default_mode(settings: &serde_json::Value) -> Option<String> {
    settings
        .get("permissions")?
        .get("defaultMode")?
        .as_str()
        .map(ToOwned::to_owned)
}

/// Pure update: set `permissions.defaultMode` in a settings value, creating the
/// `permissions` object if absent and resetting it if it is not an object,
/// while preserving every other field. Disk I/O is kept out so this is unit
/// testable.
fn apply_permission_default_mode(
    mut settings: serde_json::Value,
    value: &str,
) -> serde_json::Value {
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    let obj = settings.as_object_mut().expect("settings is an object");
    let permissions = obj
        .entry("permissions")
        .or_insert_with(|| serde_json::json!({}));
    if !permissions.is_object() {
        *permissions = serde_json::json!({});
    }
    permissions
        .as_object_mut()
        .expect("permissions is an object")
        .insert(
            "defaultMode".to_string(),
            serde_json::Value::String(value.to_string()),
        );
    settings
}

/// Write `permissions.defaultMode` into the user `settings.json`, preserving any
/// other fields/permissions keys already there.
fn save_permission_default_mode(value: &str) -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    let dir = std::path::Path::new(&home).join(".claw");
    let path = dir.join("settings.json");

    let existing: serde_json::Value = if path.exists() {
        serde_json::from_str(&std::fs::read_to_string(&path)?)?
    } else {
        serde_json::json!({})
    };
    let updated = apply_permission_default_mode(existing, value);

    std::fs::create_dir_all(&dir)?;
    std::fs::write(&path, serde_json::to_string_pretty(&updated)?)?;
    Ok(())
}

/// Print the resolved provider/model/permission settings. The API key is shown
/// only as configured/none — never the secret itself.
fn print_current_settings() {
    let cfg = load_current_provider_config();
    let key_set = cfg.api_key().is_some_and(|k| !k.is_empty()) || has_any_credentials();
    println!("  \x1b[1mCurrent settings\x1b[0m");
    println!(
        "    \x1b[2mProvider\x1b[0m     {}",
        cfg.kind().unwrap_or("(unset)")
    );
    println!(
        "    \x1b[2mModel\x1b[0m        {}",
        cfg.model().unwrap_or("(unset)")
    );
    if let Some(url) = cfg.base_url() {
        if !url.trim().is_empty() {
            println!("    \x1b[2mBase URL\x1b[0m     {url}");
        }
    }
    println!(
        "    \x1b[2mAPI key\x1b[0m      {}",
        if key_set { "configured" } else { "(none)" }
    );
    println!(
        "    \x1b[2mPermissions\x1b[0m  {}",
        read_user_settings_permission_mode()
            .unwrap_or_else(|| "workspace-write (default)".to_string())
    );
}

#[cfg(test)]
mod tests {
    use super::{
        apply_permission_default_mode, extract_permission_default_mode,
        force_custom_openai_routing, provider_env_vars, CREDENTIAL_ENV_VARS, PERMISSION_MENU_MODES,
    };
    use serde_json::json;

    #[test]
    fn permission_default_mode_round_trips() {
        let settings = apply_permission_default_mode(json!({}), "read-only");
        assert_eq!(
            extract_permission_default_mode(&settings).as_deref(),
            Some("read-only")
        );
    }

    #[test]
    fn permission_default_mode_preserves_other_fields() {
        let start = json!({
            "model": "anthropic/opus",
            "permissions": { "allow": ["Read"] }
        });
        let updated = apply_permission_default_mode(start, "dontAsk");
        // Existing top-level field and sibling permissions key survive.
        assert_eq!(updated["model"], json!("anthropic/opus"));
        assert_eq!(updated["permissions"]["allow"], json!(["Read"]));
        assert_eq!(updated["permissions"]["defaultMode"], json!("dontAsk"));
    }

    #[test]
    fn permission_default_mode_resets_non_object_permissions() {
        // A malformed `permissions` value must not panic or be left invalid.
        let updated =
            apply_permission_default_mode(json!({ "permissions": "oops" }), "workspace-write");
        assert_eq!(
            extract_permission_default_mode(&updated).as_deref(),
            Some("workspace-write")
        );
    }

    #[test]
    fn extract_returns_none_when_absent() {
        assert_eq!(extract_permission_default_mode(&json!({})), None);
        assert_eq!(
            extract_permission_default_mode(&json!({ "permissions": {} })),
            None
        );
    }

    #[test]
    fn menu_permission_values_are_canonical_config_strings() {
        // The values written to permissions.defaultMode must be ones the runtime
        // accepts (see parse_permission_mode_label in runtime::config).
        let valid = ["read-only", "workspace-write", "dontAsk"];
        for (_, value) in PERMISSION_MENU_MODES {
            assert!(valid.contains(value), "unexpected mode value: {value}");
        }
    }

    #[test]
    fn custom_openai_endpoint_forces_local_routing_prefix() {
        let out = force_custom_openai_routing(
            "openai",
            Some("https://openrouter.ai/api/v1"),
            Some("qwen/qwen3.7-plus".to_string()),
        );
        assert_eq!(out.as_deref(), Some("local/qwen/qwen3.7-plus"));
    }

    #[test]
    fn already_prefixed_models_are_left_alone() {
        let base = Some("https://openrouter.ai/api/v1");
        assert_eq!(
            force_custom_openai_routing("openai", base, Some("local/foo".to_string())).as_deref(),
            Some("local/foo")
        );
        assert_eq!(
            force_custom_openai_routing("openai", base, Some("openai/gpt-4.1".to_string()))
                .as_deref(),
            Some("openai/gpt-4.1")
        );
    }

    #[test]
    fn branded_and_non_openai_providers_are_untouched() {
        // Branded OpenAI (no custom base URL) keeps gpt-* prefix routing.
        assert_eq!(
            force_custom_openai_routing("openai", None, Some("gpt-4.1".to_string())).as_deref(),
            Some("gpt-4.1")
        );
        // A non-OpenAI kind never gets the local/ prefix even with a base URL.
        assert_eq!(
            force_custom_openai_routing(
                "anthropic",
                Some("https://example.com"),
                Some("opus".to_string())
            )
            .as_deref(),
            Some("opus")
        );
    }

    #[test]
    fn missing_model_stays_missing() {
        assert_eq!(
            force_custom_openai_routing("openai", Some("https://openrouter.ai/api/v1"), None),
            None
        );
    }

    #[test]
    fn provider_env_vars_map_known_kinds() {
        assert_eq!(
            provider_env_vars("anthropic"),
            ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL")
        );
        assert_eq!(provider_env_vars("xai"), ("XAI_API_KEY", "XAI_BASE_URL"));
        assert_eq!(
            provider_env_vars("openai"),
            ("OPENAI_API_KEY", "OPENAI_BASE_URL")
        );
        assert_eq!(
            provider_env_vars("dashscope"),
            ("DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL")
        );
    }

    #[test]
    fn custom_openai_compat_kind_falls_back_to_openai_vars() {
        // The wizard stores custom OpenAI-compatible endpoints as `openai`
        // with a custom base URL, so any unrecognized kind must route to the
        // OPENAI_* variables rather than silently dropping the credential.
        assert_eq!(
            provider_env_vars("some-self-hosted-thing"),
            ("OPENAI_API_KEY", "OPENAI_BASE_URL")
        );
    }

    #[test]
    fn every_provider_key_var_is_a_recognized_credential() {
        for kind in ["anthropic", "xai", "openai", "dashscope"] {
            let (key_var, _) = provider_env_vars(kind);
            assert!(
                CREDENTIAL_ENV_VARS.contains(&key_var),
                "{key_var} should count toward credential detection"
            );
        }
    }
}
