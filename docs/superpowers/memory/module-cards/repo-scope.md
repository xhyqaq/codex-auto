---
type: module_card
title: repo-scope
summary: Current repository scope and confirmed constraints for the planned codex-auto CLI.
tags:
  - product
  - cli
owned_paths:
  - .
related_docs:
  - docs/superpowers/memory/index.md
status: active
---

# Repo Scope

## Responsibilities

- Host a macOS-only CLI that manages multiple Codex account configurations
- Support `list`, `add`, `remove`, bare `codex-auto` interactive chat entry, and `codex-auto --account <name>` override startup
- Detect explicit quota or rate-limit failures and rotate to the next configured account
- Reconnect to the same Codex session and send `继续` after switching accounts

## Entry points

- `src/index.ts`
- `src/cli.ts`
- `src/lib/session.ts`
- `src/lib/accounts.ts`
- `src/lib/runtime.ts`

## Invariants

- Account switching is sequential, not primary/backup based
- Automatic switching is only triggered by explicit usage-limit style failures
- The product targets macOS terminal workflows only
- Conversation continuity must stay on the same Codex session via `codex resume`
- Shared runtime state lives under `~/.codex-auto/runtime`
- Account-private auth/config lives under `~/.codex-auto/accounts/<name>`

## Extension points

- Additional management commands beyond `list`, `add`, and `remove`
- Future support for non-macOS platforms
- Explicit session-id persistence if `resume --last` proves insufficient

## Common pitfalls

- Treating `config.toml` as if it contains the full login state
- Isolating the entire `CODEX_HOME` per account without preserving shared session state for resume
- Mistaking transient network or auth errors for quota exhaustion
- Assuming macOS PTY automation can rely on `node-pty` in every environment; this repo currently uses `script` for interactive runs and a plain shell fallback for non-interactive tests
