// `claw` alias binary. Identical to `jclaw`; the program detects which name it
// was invoked as at runtime (see `invoked_cli_name`). All logic lives in the
// `rusty_claude_cli` library so both binaries share one compilation.
fn main() {
    rusty_claude_cli::run_cli();
}
