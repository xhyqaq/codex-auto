---
type: lesson
title: macos-pty-execution
summary: Interactive Codex wrapping on macOS should use `node-pty` for PTY-backed execution and reserve plain shell launching only for explicit diagnostic fallback.
tags:
  - macos
  - pty
owned_paths:
  - src/lib/session.ts
related_docs:
  - docs/superpowers/memory/module-cards/repo-scope.md
status: active
---

# Situation

This repository needs to wrap the real `codex` binary, observe terminal output, and still preserve an interactive terminal experience on macOS.

# Why It Mattered

The earlier `script` workaround preserved a PTY, but it corrupted terminal redraws in real split-pane usage and broke the product experience. Re-validating `node-pty` showed that `1.1.0` still failed to spawn in the current Node 23/macOS environment, while `1.2.0-beta.12` could spawn `/bin/zsh` and preserve both redraw correctness and output monitoring.

# Rule

- For interactive macOS runs, launch Codex through `node-pty` so the child gets a real pseudo-terminal and the wrapper can still inspect live output
- In this repository, prefer `node-pty@^1.2.0-beta.12` or newer verified builds; `1.1.0` was not sufficient in the current environment
- Keep any plain shell launch path as an internal diagnostic fallback only; it must not be the default product behavior because it loses interactive quota-triggered auto-rotation

# When to Apply

- Any future work that changes `src/lib/session.ts`
- Any new acceptance or integration test that wraps the real Codex CLI on macOS
- Any dependency roll or packaging change that could affect native PTY loading

# When Not to Apply

- If the runtime moves to a different OS target
- If a later verified PTY strategy replaces `node-pty` without regressing interactive Codex behavior
