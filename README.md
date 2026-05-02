# codex-auto

English | [中文](./README.zh-CN.md)

A multi-account switcher for the `codex` CLI.

It keeps account auth under `~/.codex-auto/accounts/`, runs managed Codex sessions on top of your existing setup, and automatically rotates to the next account when the current one hits a rate limit.

## Use Cases

- You have multiple Codex accounts available
- You don't want to manually edit `auth.json` or `config.toml`
- You want automatic account rotation and session recovery when quota is exhausted
- You want to keep your original Codex sessions, plugins, and MCP configuration

## Features

- Manage multiple account configurations
- Run `codex login` automatically when adding a new account
- Bootstrap a `default` account from your existing Codex setup on first run
- Import existing `auth.json` and `config.toml` files
- Start managed runs even when the source `CODEX_HOME` has not been initialized yet
- Launch managed `codex` sessions
- Keep interactive Codex sessions usable in normal terminal workflows, including clean shell input after automatic rotation or forced stops
- Save a default start account for future runs
- Activate a managed account for the native `codex` CLI by writing only that account's `auth.json`
- Automatically switch to the next account on rate limit
- Recognize current Codex quota prompts, including upgrade/purchase messages with retry times
- Show retry times for accounts that are still waiting for quota to reset
- Bind each active managed session to its own recovery target across same-project and cross-project concurrent runs
- Resume only the session ID already bound to the current managed run instead of guessing from the latest session
- Give a fresh run a brief chance to capture its own recovery target before automatic recovery is abandoned
- If you cancel an interactive quota prompt with `Ctrl-C`, exit that managed run cleanly instead of forcing an exhausted-accounts flow
- Stop automatic recovery when the original session cannot be confirmed or its session ID is no longer valid
- Automatically send `Continue` on resume
- Log sessions and terminal transcripts
- Pass through all `codex` arguments and subcommands (e.g. `exec`, `review`, `--model`, `--full-auto`)

## Prerequisites

- Node.js 18+
- macOS or Linux terminal environment; on Windows, run `codex-auto` inside WSL instead of native `cmd.exe` or PowerShell
- `codex` CLI installed and executable
- `codex login` and `codex resume` working properly

## Installation

Install globally via npm:

```bash
npm install -g codex-auto
```

Verify the installation:

```bash
codex-auto --help
codex-auto --version
```

Upgrade to the latest version:

```bash
npm install -g codex-auto@latest
```

Uninstall:

```bash
npm uninstall -g codex-auto
```

For local development:

```bash
npm install
npm run build
npm link
```

## Quick Start

Start a managed session right away:

```bash
codex-auto
```

On first run, if your source `CODEX_HOME` already has a usable login, `codex-auto` imports it as `default` automatically.

Add more accounts:

```bash
codex-auto add a
codex-auto add b
```

List accounts:

```bash
codex-auto list
```

`codex-auto list` marks the active account with `*`. When an account is still waiting for quota to reset, the list shows the retry time from Codex next to that account.

Start a managed session:

```bash
codex-auto
```

Start with a specific account:

```bash
codex-auto --account b
```

Save a default start account for future runs:

```bash
codex-auto use b
```

Activate an account for the native `codex` CLI:

```bash
codex-auto activate b
```

`codex-auto activate <name>` writes that account's `auth.json` to the source `CODEX_HOME`, so running `codex` directly uses the same account. `codex-auto activate` without a name re-syncs the account marked with `*`.

Start from a custom source `CODEX_HOME`:

```bash
codex-auto --codex-home /path/to/.codex
```

Remove an account:

```bash
codex-auto remove b
```

Show the installed version:

```bash
codex-auto --version
codex-auto version
```

## Passing Through Codex Arguments

Any arguments not recognized as `codex-auto` own commands (`activate`, `add`, `remove`, `list`, `use`, `version`) are forwarded directly to `codex`:

```bash
# Pass a prompt
codex-auto "fix the login bug"

# Use a specific model
codex-auto --model o3 "refactor the auth module"

# Non-interactive exec mode
codex-auto exec "add unit tests"

# Full-auto with a specific account
codex-auto --account b --full-auto "migrate to TypeScript"

# Code review
codex-auto review
```

All passthrough invocations retain multi-account rotation: if the current account hits a rate limit, `codex-auto` automatically switches to the next account and resumes.

`--account <name>` is a one-run override. `codex-auto use <name>` changes the default start account for later runs.

## Importing Existing Configurations

If you already have account credentials, import them directly:

```bash
codex-auto add work --auth /path/to/auth.json --config /path/to/config.toml
```

Rules:

- `--auth` imports account credentials
- `--config` imports account configuration
- If `--auth` is not provided, `codex login` runs automatically
- `config.toml` is guaranteed to include `cli_auth_credentials_store = "file"`

## How It Works

`codex-auto` maintains its own data directory, by default at:

```bash
~/.codex-auto
```

Directory structure:

```text
~/.codex/                  # your original Codex home, kept intact
├── auth.json
├── config.toml
├── sessions/
└── ...

~/.codex-auto/
├── accounts/
│   ├── a/
│   │   ├── auth.json
│   │   ├── config.toml
│   │   └── meta.json
│   └── b/
├── instances/
│   └── <timestamp-pid-uuid>/
│       ├── auth.json
│       ├── config.toml -> ~/.codex/config.toml
│       ├── session_index.jsonl -> ~/.codex/session_index.jsonl
│       ├── sessions -> ~/.codex/sessions
│       └── ...
├── logs/
├── runs/
│   └── <run-id>.json
└── state.json
```

- `accounts/<name>/` — per-account auth/config storage
- `instances/<id>/` — per-run overlay used as `CODEX_HOME` and reused across account switches in that run
- `runs/<run-id>.json` — current managed process status, bound session ID, and recovery state
- `state.json` — account order, current index, default start account, last successful account, and the latest successfully bound session ID
- `logs/` — session logs and terminal transcripts

For each managed run, `codex-auto` creates `~/.codex-auto/instances/<id>/`, symlinks entries from the source `CODEX_HOME`, replaces only `auth.json` with a real copy from the selected account, and keeps reusing that overlay for the lifetime of the managed run. On quota switches it swaps only the overlay's `auth.json`, resumes the already bound session, and removes the overlay when the process exits. This keeps session history, plugins, MCP config, and other Codex state in the original home.

`codex-auto activate <name>` is the explicit command that writes an account's `auth.json` back to the source `CODEX_HOME` for native `codex` usage. It does not copy account `config.toml`.

Interactive sessions keep the standard Codex terminal experience, including full-screen and split-pane workflows, while `codex-auto` continues automatic account rotation and session recovery in the background and returns control to your shell in a normal input state after a forced stop or quota-driven switch.

## Account Switching & Session Recovery

The current version only triggers a switch when a genuine rate-limit message is detected, avoiding false positives from warning-like output.

When a rate limit is hit:

1. Mark the current account as exhausted
2. Switch to the next available account
3. Replace the current run overlay's `auth.json` with the next account
4. Resume only the session ID already bound to that managed run
5. Run:

```bash
codex resume <session-id> Continue
```

If a fresh run has already triggered quota handling but its recovery target is still catching up, `codex-auto` gives that run a short window to capture its own session ID before surfacing a recovery failure. If the current managed run still has not safely captured its own session ID, or if that bound session ID is no longer available, `codex-auto` stops automatic recovery and surfaces the failure instead of falling back to `codex resume --last`.

If an interactive quota prompt is already on screen and you press `Ctrl-C`, `codex-auto` treats that as a user cancel for the current managed run. It restores the terminal state and exits cleanly instead of continuing into automatic exhausted-account handling.

To prevent stale transcript interference, rate-limit detection switches to only the output after the most recent live prompt once startup or recovery has reached that prompt.

Concurrent run behavior:

- Multiple `codex-auto` sessions in different terminals for the same project each keep their own recovery binding
- Multiple `codex-auto` sessions in different terminals for different projects also recover independently
- Recovery decisions are always scoped to the active managed process, not to the latest project-level or global session

## Environment Variables

- `CODEX_AUTO_HOME`
  Data directory for `codex-auto`. Default: `~/.codex-auto`

- `CODEX_HOME`
  Source Codex home used as the overlay base. Default: `~/.codex`

- `CODEX_AUTO_CODEX_BIN`
  Path to the `codex` executable. Default: `codex`

Example:

```bash
CODEX_AUTO_HOME=/tmp/codex-auto \
CODEX_HOME=/Users/me/.codex \
CODEX_AUTO_CODEX_BIN=/opt/homebrew/bin/codex \
codex-auto --account a
```

## Command Reference

```bash
# Account management (codex-auto own commands)
codex-auto add <name>
codex-auto add <name> --auth /path/to/auth.json --config /path/to/config.toml
codex-auto list
codex-auto use <name>
codex-auto activate [name]
codex-auto remove <name>
codex-auto version
codex-auto --version

# Managed session (default)
codex-auto
codex-auto --account <name>
codex-auto --codex-home /path/to/.codex

# Passthrough to codex (all other arguments)
codex-auto [any codex arguments...]
codex-auto --account <name> [any codex arguments...]
codex-auto --codex-home /path/to/.codex [any codex arguments...]
```

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

Link locally:

```bash
npm link
```

Pack check:

```bash
npm pack --json
```

## Known Limitations

- Rate-limit detection relies on known failure messages in terminal output, not official structured events
- If the underlying `codex` session ID has been lost, `codex-auto` stops automatic recovery instead of falling back to `resume --last`
- Account rotation is based on local state order, with no weighting, priority, or health checks

## License

MIT
