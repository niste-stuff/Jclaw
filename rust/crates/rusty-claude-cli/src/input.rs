use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::io::{self, IsTerminal, Write};

use rustyline::completion::{Completer, Pair};
use rustyline::error::ReadlineError;
use rustyline::highlight::{CmdKind, Highlighter};
use rustyline::hint::Hinter;
use rustyline::history::DefaultHistory;
use rustyline::validate::Validator;
use rustyline::{
    Cmd, CompletionType, ConditionalEventHandler, Config, Context, EditMode, Editor, Event,
    EventContext, EventHandler, Helper, KeyCode, KeyEvent, Modifiers, RepeatCount,
};

use commands::slash_command_specs;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadOutcome {
    Submit(String),
    Cancel,
    Exit,
}

struct SlashCommandHelper {
    completions: Vec<String>,
    current_line: RefCell<String>,
}

impl SlashCommandHelper {
    fn new(completions: Vec<String>) -> Self {
        Self {
            completions: normalize_completions(completions),
            current_line: RefCell::new(String::new()),
        }
    }

    fn reset_current_line(&self) {
        self.current_line.borrow_mut().clear();
    }

    fn current_line(&self) -> String {
        self.current_line.borrow().clone()
    }

    fn set_current_line(&self, line: &str) {
        let mut current = self.current_line.borrow_mut();
        current.clear();
        current.push_str(line);
    }

    fn set_completions(&mut self, completions: Vec<String>) {
        self.completions = normalize_completions(completions);
    }
}

impl Completer for SlashCommandHelper {
    type Candidate = Pair;

    fn complete(
        &self,
        line: &str,
        pos: usize,
        _ctx: &Context<'_>,
    ) -> rustyline::Result<(usize, Vec<Self::Candidate>)> {
        let Some(prefix) = slash_command_prefix(line, pos) else {
            return Ok((0, Vec::new()));
        };

        // When the prefix is empty or just "/", the user has only opened the
        // menu (e.g. by typing "/") and hasn't picked a command yet — show the
        // clean top-level command list, not every "/cmd arg" expansion.
        let top_level_only = prefix.trim_start_matches('/').is_empty();
        let width = menu_width();

        let matches = self
            .completions
            .iter()
            .filter(|candidate| candidate.starts_with(prefix))
            .filter(|candidate| !top_level_only || is_top_level_command(candidate))
            .map(|candidate| Pair {
                display: format_menu_entry(candidate, width),
                replacement: candidate.clone(),
            })
            .collect();

        Ok((0, matches))
    }
}

impl Hinter for SlashCommandHelper {
    type Hint = String;
}

impl Highlighter for SlashCommandHelper {
    fn highlight<'l>(&self, line: &'l str, _pos: usize) -> Cow<'l, str> {
        self.set_current_line(line);
        Cow::Borrowed(line)
    }

    fn highlight_char(&self, line: &str, _pos: usize, _kind: CmdKind) -> bool {
        self.set_current_line(line);
        false
    }
}

impl Validator for SlashCommandHelper {}
impl Helper for SlashCommandHelper {}

pub struct LineEditor {
    prompt: String,
    editor: Editor<SlashCommandHelper, DefaultHistory>,
}

impl LineEditor {
    #[must_use]
    pub fn new(prompt: impl Into<String>, completions: Vec<String>) -> Self {
        let config = Config::builder()
            .completion_type(CompletionType::List)
            .edit_mode(EditMode::Emacs)
            .build();
        let mut editor = Editor::<SlashCommandHelper, DefaultHistory>::with_config(config)
            .expect("rustyline editor should initialize");
        editor.set_helper(Some(SlashCommandHelper::new(completions)));
        editor.bind_sequence(KeyEvent(KeyCode::Char('J'), Modifiers::CTRL), Cmd::Newline);
        editor.bind_sequence(KeyEvent(KeyCode::Enter, Modifiers::SHIFT), Cmd::Newline);
        // Typing "/" on an empty line pops the slash-command menu immediately
        // (rustyline completes the common "/" prefix and lists the commands),
        // mirroring the live command picker. Mid-line "/" inserts normally.
        editor.bind_sequence(
            KeyEvent(KeyCode::Char('/'), Modifiers::NONE),
            EventHandler::Conditional(Box::new(SlashMenuTrigger)),
        );

        Self {
            prompt: prompt.into(),
            editor,
        }
    }

    pub fn push_history(&mut self, entry: impl Into<String>) {
        let entry = entry.into();
        if entry.trim().is_empty() {
            return;
        }

        let _ = self.editor.add_history_entry(entry);
    }

    pub fn set_completions(&mut self, completions: Vec<String>) {
        if let Some(helper) = self.editor.helper_mut() {
            helper.set_completions(completions);
        }
    }

    pub fn read_line(&mut self) -> io::Result<ReadOutcome> {
        if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
            return self.read_line_fallback();
        }

        if let Some(helper) = self.editor.helper_mut() {
            helper.reset_current_line();
        }

        match self.editor.readline(&self.prompt) {
            Ok(line) => Ok(ReadOutcome::Submit(line)),
            Err(ReadlineError::Interrupted) => {
                let has_input = !self.current_line().is_empty();
                self.finish_interrupted_read()?;
                if has_input {
                    Ok(ReadOutcome::Cancel)
                } else {
                    Ok(ReadOutcome::Exit)
                }
            }
            Err(ReadlineError::Eof) => {
                self.finish_interrupted_read()?;
                Ok(ReadOutcome::Exit)
            }
            Err(error) => Err(io::Error::other(error)),
        }
    }

    fn current_line(&self) -> String {
        self.editor
            .helper()
            .map_or_else(String::new, SlashCommandHelper::current_line)
    }

    fn finish_interrupted_read(&mut self) -> io::Result<()> {
        if let Some(helper) = self.editor.helper_mut() {
            helper.reset_current_line();
        }
        let mut stdout = io::stdout();
        writeln!(stdout)
    }

    fn read_line_fallback(&self) -> io::Result<ReadOutcome> {
        let mut stdout = io::stdout();
        write!(stdout, "{}", self.prompt)?;
        stdout.flush()?;

        let mut buffer = String::new();
        let bytes_read = io::stdin().read_line(&mut buffer)?;
        if bytes_read == 0 {
            return Ok(ReadOutcome::Exit);
        }

        while matches!(buffer.chars().last(), Some('\n' | '\r')) {
            buffer.pop();
        }
        Ok(ReadOutcome::Submit(buffer))
    }
}

fn slash_command_prefix(line: &str, pos: usize) -> Option<&str> {
    if pos != line.len() {
        return None;
    }

    let prefix = &line[..pos];
    // An empty line is treated as the start of a slash command so the "/"
    // trigger (and Tab on an empty prompt) can list every command.
    if prefix.is_empty() {
        return Some("");
    }
    if !prefix.starts_with('/') {
        return None;
    }

    Some(prefix)
}

/// A candidate is "top level" when it is a bare command with no argument, e.g.
/// `/model` but not `/model opus`.
fn is_top_level_command(candidate: &str) -> bool {
    !candidate
        .trim_start_matches('/')
        .contains(char::is_whitespace)
}

/// One-line description for a candidate, looked up from the command spec table
/// by the candidate's leading command name (ignoring any arguments).
fn candidate_description(candidate: &str) -> &'static str {
    let name = candidate
        .trim_start_matches('/')
        .split_whitespace()
        .next()
        .unwrap_or("");
    if name.is_empty() {
        return "";
    }
    slash_command_specs()
        .iter()
        .find(|spec| spec.name == name || spec.aliases.contains(&name))
        .map_or("", |spec| spec.summary)
}

fn menu_width() -> usize {
    crossterm::terminal::size()
        .map(|(cols, _)| cols as usize)
        .unwrap_or(80)
        .clamp(40, 120)
}

/// Render a menu row as `"/command            description"`, padding the command
/// into a fixed left column and truncating the description to fit the terminal.
fn format_menu_entry(candidate: &str, width: usize) -> String {
    const COMMAND_COLUMN: usize = 22;
    let description = candidate_description(candidate);
    if description.is_empty() {
        return candidate.to_string();
    }
    let available = width.saturating_sub(COMMAND_COLUMN + 2).max(12);
    let description = truncate_with_ellipsis(description, available);
    format!("{candidate:<COMMAND_COLUMN$}  {description}")
}

fn truncate_with_ellipsis(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Opens the slash-command menu when "/" is pressed at the start of an empty
/// line; otherwise lets "/" insert normally.
struct SlashMenuTrigger;

impl ConditionalEventHandler for SlashMenuTrigger {
    fn handle(
        &self,
        _evt: &Event,
        _n: RepeatCount,
        _positive: bool,
        ctx: &EventContext,
    ) -> Option<Cmd> {
        if ctx.line().is_empty() {
            Some(Cmd::Complete)
        } else {
            None
        }
    }
}

fn normalize_completions(completions: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    completions
        .into_iter()
        .filter(|candidate| candidate.starts_with('/'))
        .filter(|candidate| seen.insert(candidate.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        candidate_description, format_menu_entry, is_top_level_command, slash_command_prefix,
        LineEditor, SlashCommandHelper,
    };
    use rustyline::completion::Completer;
    use rustyline::highlight::Highlighter;
    use rustyline::history::{DefaultHistory, History};
    use rustyline::Context;

    #[test]
    fn extracts_terminal_slash_command_prefixes_with_arguments() {
        assert_eq!(slash_command_prefix("/he", 3), Some("/he"));
        assert_eq!(slash_command_prefix("/help me", 8), Some("/help me"));
        assert_eq!(
            slash_command_prefix("/session switch ses", 19),
            Some("/session switch ses")
        );
        assert_eq!(slash_command_prefix("hello", 5), None);
        assert_eq!(slash_command_prefix("/help", 2), None);
    }

    #[test]
    fn empty_line_prefix_opens_the_command_menu() {
        assert_eq!(slash_command_prefix("", 0), Some(""));
    }

    #[test]
    fn empty_prefix_lists_only_top_level_commands() {
        let helper = SlashCommandHelper::new(vec![
            "/model".to_string(),
            "/model opus".to_string(),
            "/help".to_string(),
        ]);
        let history = DefaultHistory::new();
        let ctx = Context::new(&history);
        let (start, matches) = helper
            .complete("", 0, &ctx)
            .expect("completion should work");

        assert_eq!(start, 0);
        let replacements: Vec<_> = matches.into_iter().map(|c| c.replacement).collect();
        assert!(replacements.contains(&"/model".to_string()));
        assert!(replacements.contains(&"/help".to_string()));
        assert!(!replacements.contains(&"/model opus".to_string()));
    }

    #[test]
    fn menu_entry_shows_command_description() {
        // `/help` has a known spec summary, so the rendered display row should
        // contain both the command and its description.
        let entry = format_menu_entry("/help", 80);
        assert!(entry.starts_with("/help"));
        assert!(entry.contains(candidate_description("/help")));
        assert!(!candidate_description("/help").is_empty());
    }

    #[test]
    fn argument_candidate_description_falls_back_to_command() {
        assert_eq!(
            candidate_description("/model opus"),
            candidate_description("/model")
        );
    }

    #[test]
    fn top_level_command_detection() {
        assert!(is_top_level_command("/model"));
        assert!(!is_top_level_command("/model opus"));
    }

    #[test]
    fn completes_matching_slash_commands() {
        let helper = SlashCommandHelper::new(vec![
            "/help".to_string(),
            "/hello".to_string(),
            "/status".to_string(),
        ]);
        let history = DefaultHistory::new();
        let ctx = Context::new(&history);
        let (start, matches) = helper
            .complete("/he", 3, &ctx)
            .expect("completion should work");

        assert_eq!(start, 0);
        assert_eq!(
            matches
                .into_iter()
                .map(|candidate| candidate.replacement)
                .collect::<Vec<_>>(),
            vec!["/help".to_string(), "/hello".to_string()]
        );
    }

    #[test]
    fn completes_matching_slash_command_arguments() {
        let helper = SlashCommandHelper::new(vec![
            "/model".to_string(),
            "/model opus".to_string(),
            "/model sonnet".to_string(),
            "/session switch alpha".to_string(),
        ]);
        let history = DefaultHistory::new();
        let ctx = Context::new(&history);
        let (start, matches) = helper
            .complete("/model o", 8, &ctx)
            .expect("completion should work");

        assert_eq!(start, 0);
        assert_eq!(
            matches
                .into_iter()
                .map(|candidate| candidate.replacement)
                .collect::<Vec<_>>(),
            vec!["/model opus".to_string()]
        );
    }

    #[test]
    fn ignores_non_slash_command_completion_requests() {
        let helper = SlashCommandHelper::new(vec!["/help".to_string()]);
        let history = DefaultHistory::new();
        let ctx = Context::new(&history);
        let (_, matches) = helper
            .complete("hello", 5, &ctx)
            .expect("completion should work");

        assert!(matches.is_empty());
    }

    #[test]
    fn tracks_current_buffer_through_highlighter() {
        let helper = SlashCommandHelper::new(Vec::new());
        let _ = helper.highlight("draft", 5);

        assert_eq!(helper.current_line(), "draft");
    }

    #[test]
    fn push_history_ignores_blank_entries() {
        let mut editor = LineEditor::new("> ", vec!["/help".to_string()]);
        editor.push_history("   ");
        editor.push_history("/help");

        assert_eq!(editor.editor.history().len(), 1);
    }

    #[test]
    fn set_completions_replaces_and_normalizes_candidates() {
        let mut editor = LineEditor::new("> ", vec!["/help".to_string()]);
        editor.set_completions(vec![
            "/model opus".to_string(),
            "/model opus".to_string(),
            "status".to_string(),
        ]);

        let helper = editor.editor.helper().expect("helper should exist");
        assert_eq!(helper.completions, vec!["/model opus".to_string()]);
    }
}
