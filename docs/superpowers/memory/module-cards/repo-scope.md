---
type: module_card
title: repo-scope
summary: Current repository scope and confirmed constraints for the codex-auto CLI.
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
- Account-private auth/config lives under `~/.codex-auto/accounts/<name>`
- Managed runs use per-instance overlays under `~/.codex-auto/instances/<id>`
- The overlay base comes from `CODEX_HOME` or defaults to `~/.codex`

## Extension points

- Additional management commands beyond `list`, `add`, and `remove`
- Future support for non-macOS platforms
- Explicit session-id persistence if `resume --last` proves insufficient

## Common pitfalls

- Treating `config.toml` as if it contains the full login state
- Reintroducing a single mutable shared runtime and breaking concurrent managed sessions
- Assuming overlay cleanup is optional; stale instance directories should be treated as disposable runtime artifacts
- Mistaking transient network or auth errors for quota exhaustion
- Treating `script` as an acceptable default PTY wrapper; split-pane redraw regressions make that product behavior invalid
- Rolling back `node-pty` below the currently verified line without re-testing interactive spawn and redraw behavior
