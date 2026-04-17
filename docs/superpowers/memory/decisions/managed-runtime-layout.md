---
type: decision
title: managed-runtime-layout
summary: codex-auto keeps one shared runtime home for session continuity and one private directory per account for auth isolation.
tags:
  - runtime
  - accounts
owned_paths:
  - src/lib/runtime.ts
  - src/lib/state.ts
  - src/lib/accounts.ts
related_docs:
  - docs/superpowers/memory/module-cards/repo-scope.md
status: accepted
---

# Context

Codex sessions are tied to data under `CODEX_HOME`, but multi-account support also requires isolated authentication state per account. A naive "one full `CODEX_HOME` per account" model breaks `codex resume --last` continuity.

# Decision

- Keep one shared runtime home under `~/.codex-auto/runtime`
- Store account-private `auth.json` and `config.toml` under `~/.codex-auto/accounts/<name>`
- On launch or rotation, copy only the target account auth/config into runtime
- Never replace runtime session/history/state files during account switches

# Alternatives Considered

- A single `~/.codex/config.toml` with multiple profiles
- A full isolated `CODEX_HOME` per account

# Trade-offs

- This preserves `resume --last` continuity and simple sequential rotation
- It requires a runtime lock because multiple concurrent `codex-auto` runs would race on the shared runtime home
- It assumes Codex can resume from the shared runtime after auth/config replacement

# Revisit Signals

- `resume --last` fails to reconnect the expected thread in real use
- Users need concurrent managed sessions against different account pools
- Users need per-account runtime features beyond auth/config
