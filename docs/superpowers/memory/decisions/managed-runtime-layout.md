---
type: decision
title: managed-runtime-layout
summary: codex-auto keeps account auth under ~/.codex-auto and runs each managed session from a per-instance symlink overlay built on top of the user's original CODEX_HOME.
tags:
  - runtime
  - accounts
  - overlay
owned_paths:
  - src/lib/runtime.ts
  - src/lib/session.ts
  - src/lib/state.ts
  - src/lib/accounts.ts
related_docs:
  - docs/superpowers/memory/module-cards/repo-scope.md
status: accepted
---

# Context

Codex sessions, plugins, MCP configuration, and local state are tied to data under `CODEX_HOME`, while multi-account support still requires isolated authentication state per account. The original shared-runtime design preserved `resume --last`, but it serialized all managed runs through one mutable `~/.codex-auto/runtime` directory and required a global lock.

# Decision

- Store account-private `auth.json` and `config.toml` under `~/.codex-auto/accounts/<name>`
- Resolve the source Codex home from `CODEX_HOME` or default to `~/.codex`
- For every managed launch and every quota-driven account switch, create a temporary overlay under `~/.codex-auto/instances/<id>/`
- Symlink entries from the source `CODEX_HOME` into the overlay and replace only `auth.json` with a real file copied from the selected account
- Launch `codex` with `CODEX_HOME` pointing at that overlay, then delete the overlay when the invocation ends
- Read session continuity data through the overlay so symlinked `session_index.jsonl` and `sessions/` still resolve to the source home
- Do not use a global runtime lock; concurrent `codex-auto` runs each get their own overlay

# Alternatives Considered

- A single mutable shared runtime under `~/.codex-auto/runtime`
- A single `~/.codex/config.toml` with multiple profiles
- A full isolated `CODEX_HOME` per account with no shared source home

# Trade-offs

- This preserves the original Codex session history, plugins, MCP config, and other local state without rewriting the user's base home
- It removes cross-process contention because each `codex-auto` instance owns a private overlay
- It keeps auth isolation limited to `auth.json`; account-specific config is still stored for account management but is not merged into the runtime overlay
- It assumes Codex behaves correctly when most overlay entries are symlinks into the source home, including SQLite access via symlinked files

# Revisit Signals

- Codex starts writing critical state only to paths that did not exist in the source home and therefore were not symlinked into the overlay
- Codex changes file-access behavior in ways that break symlinked `CODEX_HOME` entries
- Users need account-specific runtime config to override the source `config.toml` during managed runs
