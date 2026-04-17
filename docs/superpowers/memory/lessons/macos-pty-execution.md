---
type: lesson
title: macos-pty-execution
summary: Interactive Codex wrapping on macOS should prefer the system `script` command, with a plain shell fallback for non-interactive tests.
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

`node-pty` was installed successfully but failed to spawn reliably in this environment. The repo still needed a PTY-backed interactive path to support real Codex sessions.

# Rule

- For interactive macOS runs, launch Codex through the system `script` command so the child gets a pseudo-terminal
- For non-interactive tests, skip `script` and run the shell command directly, because `script` expects a real TTY and can fail on sockets or test harness pipes

# When to Apply

- Any future work that changes `src/lib/session.ts`
- Any new acceptance or integration test that wraps the real Codex CLI on macOS

# When Not to Apply

- If the runtime moves to a different OS target
- If a later verified PTY strategy replaces `script` without regressing interactive Codex behavior
