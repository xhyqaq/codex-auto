# Account Retry Time Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. It will decide whether each batch should run in parallel or serial subagent mode and will pass only task-local context to each subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture Codex quota reset times, persist them per account, and show them in `codex-auto list` until they expire or the account succeeds again.

**Architecture:** Extend quota detection with retry-time extraction, persist retry availability by account in `state.json`, clear it on success or expiry, and render the display string in `list` without exposing internal timestamps.

**Tech Stack:** TypeScript, Node.js, Commander, Vitest

---

### Task 1: Extend state for per-account retry availability

**Files:**
- Modify: `src/lib/state.ts`
- Test: `tests/state/state.test.ts`

- [ ] **Step 1: Write failing tests for retry availability normalization**
- [ ] **Step 2: Run `npm test -- --run tests/state/state.test.ts` and verify failure**
- [ ] **Step 3: Add `retryAvailabilityByAccount` to `AppState`, normalize legacy/missing values, and clear expired entries during `loadState()`**
- [ ] **Step 4: Re-run `npm test -- --run tests/state/state.test.ts` and verify pass**

### Task 2: Add retry-time parsing to quota detection

**Files:**
- Modify: `src/lib/detection.ts`
- Test: `tests/runtime/detection.test.ts`

- [ ] **Step 1: Write failing tests for extracting `11:10 PM` and parsing it into an ISO timestamp**
- [ ] **Step 2: Run `npm test -- --run tests/runtime/detection.test.ts` and verify failure**
- [ ] **Step 3: Implement a helper that returns both `displayText` and `availableAt` from quota text**
- [ ] **Step 4: Re-run `npm test -- --run tests/runtime/detection.test.ts` and verify pass**

### Task 3: Persist retry availability during managed runs

**Files:**
- Modify: `src/lib/session.ts`
- Test: `tests/session/session.test.ts`

- [ ] **Step 1: Write failing tests proving quota hits save retry availability and successful runs clear it**
- [ ] **Step 2: Run `npm test -- --run tests/session/session.test.ts` and verify failure**
- [ ] **Step 3: Thread retry info through invocation results and update `state.retryAvailabilityByAccount` on quota hit / success**
- [ ] **Step 4: Re-run `npm test -- --run tests/session/session.test.ts` and verify pass**

### Task 4: Render retry availability in account listings

**Files:**
- Modify: `src/lib/accounts.ts`
- Test: `tests/accounts/accounts.test.ts`
- Test: `tests/cli/cli.test.ts`

- [ ] **Step 1: Write failing tests for `list` output with `retry at 11:10 PM` and `(default)` coexisting**
- [ ] **Step 2: Run `npm test -- --run tests/accounts/accounts.test.ts tests/cli/cli.test.ts` and verify failure**
- [ ] **Step 3: Update list rendering and account removal cleanup for retry availability**
- [ ] **Step 4: Re-run `npm test -- --run tests/accounts/accounts.test.ts tests/cli/cli.test.ts` and verify pass**

### Task 5: Update product docs and run full verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Document that `codex-auto list` shows waiting accounts and their retry time**
- [ ] **Step 2: Run `npm test` and verify all suites pass**
- [ ] **Step 3: Run `npm run build` and verify success**
