// Primary jclaw binary. `jclaw` with no subcommand launches the vendored
// full-screen TUI (see the library's `tui` module). All logic lives in the
// `rusty_claude_cli` library so `claw` and `jclaw` share one compilation.
fn main() {
    rusty_claude_cli::run_cli();
}
