---
type: module_card
title: repository-memory-index
summary: Canonical memory index for the greenfield codex-auto CLI repository.
tags:
  - repository
  - codex-auto
owned_paths:
  - docs/superpowers/memory/**
status: active
---

# Repository Memory Index

## Covered domains

- Product scope for the `codex-auto` CLI
- Confirmed external constraints from local `codex` CLI inspection
- Runtime/account storage layout
- macOS PTY execution strategy

## Primary docs

- [repo-scope](./module-cards/repo-scope.md)
- [managed-runtime-layout](./decisions/managed-runtime-layout.md)
- [macos-pty-execution](./lessons/macos-pty-execution.md)

## Major gaps

- No explicit session-id fallback when `resume --last` is insufficient
- No user-facing configuration command beyond `list`, `add`, and `remove`
