# codex-auto

English | [中文](./README.zh-CN.md)

A multi-account switcher for the `codex` CLI.

It maintains multiple isolated `CODEX_HOME` directories and automatically rotates to the next account when the current one hits a rate limit, resuming the session where it left off.

## Use Cases

- You have multiple Codex accounts available
- You don't want to manually edit `auth.json` or `config.toml`
- You want automatic account rotation and session recovery when quota is exhausted

## Features

- Manage multiple account configurations
- Run `codex login` automatically when adding a new account
- Import existing `auth.json` and `config.toml` files
- Launch managed `codex` sessions
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

Add accounts:

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
~/.codex-auto/
├── accounts/
│   ├── a/
│   │   ├── auth.json
│   │   ├── config.toml
│   │   └── meta.json
│   └── b/
├── runtime/
│   ├── auth.json
│   ├── config.toml
│   ├── session_index.jsonl
│   └── sessions/
├── logs/
└── state.json
```

- `accounts/<name>/` — per-account configuration
- `runtime/` — the working directory actually used by `codex`
- `state.json` — account order, current index, last successful account, latest session ID
- `logs/` — session logs and terminal transcripts

Before each launch, `codex-auto` syncs the target account's `auth.json` and `config.toml` into `runtime/`, then starts `codex` using that runtime directory.

## Account Switching & Session Recovery

The current version only triggers a switch when a genuine rate-limit message is detected, avoiding false positives from warning-like output.

When a rate limit is hit:

1. Mark the current account as exhausted
2. Switch to the next available account
3. Read the latest session ID from runtime
4. Attempt to resume:

```bash
codex resume <session-id> Continue
```

5. If the session ID is invalid, fall back to:

```bash
codex resume --last
```

To prevent stale transcript interference, only output after the most recent prompt is used for rate-limit detection during recovery.

## Environment Variables

- `CODEX_AUTO_HOME`
  Data directory for `codex-auto`. Default: `~/.codex-auto`

- `CODEX_AUTO_CODEX_BIN`
  Path to the `codex` executable. Default: `codex`

Example:

```bash
CODEX_AUTO_HOME=/tmp/codex-auto \
CODEX_AUTO_CODEX_BIN=/opt/homebrew/bin/codex \
codex-auto --account a
```

## Command Reference

```bash
# Account management (codex-auto own commands)
codex-auto add <name>
codex-auto add <name> --auth /path/to/auth.json --config /path/to/config.toml
codex-auto list
codex-auto remove <name>

# Managed session (default)
codex-auto
codex-auto --account <name>

# Passthrough to codex (all other arguments)
codex-auto [any codex arguments...]
codex-auto --account <name> [any codex arguments...]
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
