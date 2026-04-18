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
- Launch managed `codex` sessions
- Keep interactive Codex sessions usable in normal terminal workflows
- Save a default start account for future runs
- Automatically switch to the next account on rate limit
- Resume sessions using recorded session IDs
- Fall back to `codex resume --last` if the session ID is invalid
- Automatically send `Continue` on resume
- Log sessions and terminal transcripts
- Pass through all `codex` arguments and subcommands (e.g. `exec`, `review`, `--model`, `--full-auto`)

## Prerequisites

- Node.js 18+
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

Start from a custom source `CODEX_HOME`:

```bash
codex-auto --codex-home /path/to/.codex
```

Remove an account:

```bash
codex-auto remove b
```

## Passing Through Codex Arguments

Any arguments not recognized as `codex-auto` own commands (`add`, `remove`, `list`) are forwarded directly to `codex`:

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
│   └── <timestamp-pid-seq>/
│       ├── auth.json
│       ├── config.toml -> ~/.codex/config.toml
│       ├── session_index.jsonl -> ~/.codex/session_index.jsonl
│       ├── sessions -> ~/.codex/sessions
│       └── ...
├── logs/
└── state.json
```

- `accounts/<name>/` — per-account auth/config storage
- `instances/<id>/` — per-run temporary overlay used as `CODEX_HOME`
- `state.json` — account order, current index, default start account, last successful account, latest session ID
- `logs/` — session logs and terminal transcripts

For each managed run, `codex-auto` creates `~/.codex-auto/instances/<id>/`, symlinks entries from the source `CODEX_HOME`, replaces only `auth.json` with a real copy from the selected account, launches `codex` with that overlay, then removes the overlay when the process exits. This keeps session history, plugins, MCP config, and other Codex state in the original home.

Interactive sessions keep the standard Codex terminal experience, including full-screen and split-pane workflows, while `codex-auto` continues automatic account rotation and session recovery in the background.

## Account Switching & Session Recovery

The current version only triggers a switch when a genuine rate-limit message is detected, avoiding false positives from warning-like output.

When a rate limit is hit:

1. Mark the current account as exhausted
2. Switch to the next available account
3. Rebuild the overlay with the next account's `auth.json`
4. Read the latest session ID from the current overlay
5. Attempt to resume:

```bash
codex resume <session-id> Continue
```

6. If the session ID is invalid, fall back to:

```bash
codex resume --last
```

To prevent stale transcript interference, only output after the most recent prompt is used for rate-limit detection during recovery.

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
codex-auto remove <name>

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
- `resume --last` fallback does not re-inject the original prompt; it only restores the session
- Account rotation is based on local state order, with no weighting, priority, or health checks

## License

MIT
