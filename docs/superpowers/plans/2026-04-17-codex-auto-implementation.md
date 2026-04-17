# codex-auto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. It will decide whether each batch should run in parallel or serial subagent mode and will pass only task-local context to each subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS-only CLI that manages multiple Codex accounts, starts a managed Codex session, rotates to the next account on explicit quota/rate-limit failures, resumes the same session, and automatically sends `继续`.

**Architecture:** The CLI keeps one shared runtime `CODEX_HOME` under `~/.codex-auto/runtime` for session continuity and one private directory per account under `~/.codex-auto/accounts/<name>` for auth/config isolation. A PTY runner starts the real `codex`, watches sanitized terminal output for explicit limit errors, swaps runtime auth/config to the next account, and relaunches with `codex resume --last "继续"`.

**Tech Stack:** Node.js 24, TypeScript, Commander, node-pty, Vitest, Zod, IARNA TOML

---

### Task 1: Bootstrap the Node/TypeScript project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Write the failing bootstrap test**

```ts
import { describe, expect, test } from 'vitest';
import { existsSync } from 'node:fs';

describe('project bootstrap', () => {
  test('package metadata exists', () => {
    expect(existsSync(new URL('../../package.json', import.meta.url))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/bootstrap/bootstrap.test.ts`
Expected: FAIL because the project files do not exist yet

- [ ] **Step 3: Write minimal project scaffold**

```json
{
  "name": "codex-auto",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "codex-auto": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

```ts
#!/usr/bin/env node
console.log('codex-auto bootstrap');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/bootstrap/bootstrap.test.ts`
Expected: PASS

### Task 2: Add filesystem/state primitives

**Files:**
- Create: `src/lib/paths.ts`
- Create: `src/lib/fs.ts`
- Create: `src/lib/state.ts`
- Create: `tests/state/state.test.ts`

- [ ] **Step 1: Write the failing state tests**

```ts
test('creates empty state when the file is missing', async () => {
  const state = await loadState(tempHome);
  expect(state.accounts).toEqual([]);
  expect(state.currentIndex).toBeNull();
});

test('removes the last account cleanly', async () => {
  await saveState(tempHome, {
    version: 1,
    accounts: ['solo'],
    currentIndex: 0,
    lastSuccessfulAccount: 'solo',
    updatedAt: '2026-04-17T00:00:00.000Z'
  });

  const next = removeAccountFromState(await loadState(tempHome), 'solo');
  expect(next.accounts).toEqual([]);
  expect(next.currentIndex).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/state/state.test.ts`
Expected: FAIL because `loadState`, `saveState`, and `removeAccountFromState` do not exist

- [ ] **Step 3: Implement minimal filesystem/state utilities**

```ts
export type AppState = {
  version: 1;
  accounts: string[];
  currentIndex: number | null;
  lastSuccessfulAccount: string | null;
  updatedAt: string;
};

export async function loadState(appHome: string): Promise<AppState> { /* ... */ }
export async function saveState(appHome: string, state: AppState): Promise<void> { /* ... */ }
export function removeAccountFromState(state: AppState, name: string): AppState { /* ... */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/state/state.test.ts`
Expected: PASS

### Task 3: Add account management services

**Files:**
- Create: `src/lib/account-config.ts`
- Create: `src/lib/accounts.ts`
- Create: `tests/accounts/accounts.test.ts`

- [ ] **Step 1: Write the failing account tests**

```ts
test('addAccount appends a new account to the rotation list', async () => {
  await addAccount(tempHome, 'alpha', fakeLogin);
  const state = await loadState(tempHome);
  expect(state.accounts).toEqual(['alpha']);
  expect(readFileSync(accountConfigPath(tempHome, 'alpha'), 'utf8')).toContain('cli_auth_credentials_store = "file"');
});

test('removeAccount deletes account data and keeps empty state valid', async () => {
  await seedAccount(tempHome, 'alpha');
  await removeAccount(tempHome, 'alpha');
  const state = await loadState(tempHome);
  expect(state.accounts).toEqual([]);
  expect(existsSync(accountDir(tempHome, 'alpha'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/accounts/accounts.test.ts`
Expected: FAIL because the account service does not exist

- [ ] **Step 3: Implement account directory creation, login handoff, and removal**

```ts
export type LoginRunner = (accountHome: string) => Promise<void>;

export async function addAccount(appHome: string, name: string, runLogin: LoginRunner): Promise<void> { /* ... */ }
export async function removeAccount(appHome: string, name: string): Promise<void> { /* ... */ }
export function renderAccountList(state: AppState): string { /* ... */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/accounts/accounts.test.ts`
Expected: PASS

### Task 4: Add quota detection and rotation logic

**Files:**
- Create: `src/lib/detection.ts`
- Create: `src/lib/rotation.ts`
- Create: `tests/runtime/detection.test.ts`
- Create: `tests/runtime/rotation.test.ts`

- [ ] **Step 1: Write the failing detection and rotation tests**

```ts
test('detects explicit quota errors from sanitized output', () => {
  expect(hasQuotaError('Error: usage limit exceeded for this account')).toBe(true);
  expect(hasQuotaError('network timeout while calling tool')).toBe(false);
});

test('selects the next non-exhausted account in order', () => {
  const next = pickNextAccount(['a', 'b', 'c'], 0, new Set(['a', 'b']));
  expect(next).toEqual({ name: 'c', index: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/runtime/detection.test.ts tests/runtime/rotation.test.ts`
Expected: FAIL because detection and rotation helpers do not exist

- [ ] **Step 3: Implement the minimal helpers**

```ts
export function hasQuotaError(output: string): boolean { /* regex match */ }
export function pickNextAccount(accounts: string[], currentIndex: number, exhausted: Set<string>) { /* ... */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/runtime/detection.test.ts tests/runtime/rotation.test.ts`
Expected: PASS

### Task 5: Add runtime config/auth synchronization and lock handling

**Files:**
- Create: `src/lib/runtime.ts`
- Create: `src/lib/lock.ts`
- Create: `tests/runtime/runtime.test.ts`
- Create: `tests/runtime/lock.test.ts`

- [ ] **Step 1: Write the failing runtime tests**

```ts
test('syncRuntimeAccount copies auth and writes merged runtime config', async () => {
  await syncRuntimeAccount(appHome, 'alpha', workspaceDir);
  expect(readFileSync(runtimeAuthPath(appHome), 'utf8')).toContain('token');
  expect(readFileSync(runtimeConfigPath(appHome), 'utf8')).toContain('cli_auth_credentials_store = "file"');
});

test('lock acquisition fails when a live pid already owns the runtime', async () => {
  await writeLiveLock(appHome, process.pid);
  await expect(acquireRuntimeLock(appHome)).rejects.toThrow(/already running/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/runtime/runtime.test.ts tests/runtime/lock.test.ts`
Expected: FAIL because sync and lock services do not exist

- [ ] **Step 3: Implement sync and lock services**

```ts
export async function syncRuntimeAccount(appHome: string, accountName: string, workspaceDir: string): Promise<void> { /* ... */ }
export async function acquireRuntimeLock(appHome: string): Promise<() => Promise<void>> { /* ... */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/runtime/runtime.test.ts tests/runtime/lock.test.ts`
Expected: PASS

### Task 6: Add the PTY-managed session runner

**Files:**
- Create: `src/lib/codex-bin.ts`
- Create: `src/lib/logger.ts`
- Create: `src/lib/session.ts`
- Create: `tests/session/session.test.ts`
- Create: `tests/fixtures/fake-codex.mjs`

- [ ] **Step 1: Write the failing session tests**

```ts
test('switches accounts and resumes with 继续 after quota failure', async () => {
  const result = await runManagedSession({
    appHome,
    workspaceDir,
    codexBin: `node ${fixturePath('fake-codex.mjs')}`,
    initialAccount: { name: 'a', index: 0 }
  });

  expect(result.switchCount).toBe(1);
  expect(result.finalAccount).toBe('b');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/session/session.test.ts`
Expected: FAIL because the session runner does not exist

- [ ] **Step 3: Implement PTY launch, output buffering, quota-triggered rotation, and resume**

```ts
export async function runManagedSession(options: RunManagedSessionOptions): Promise<RunManagedSessionResult> {
  // launch codex in a PTY
  // sanitize output and detect quota errors
  // rotate account and call resume --last "继续"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/session/session.test.ts`
Expected: PASS

### Task 7: Wire the CLI commands together

**Files:**
- Create: `src/cli.ts`
- Modify: `src/index.ts`
- Create: `tests/cli/cli.test.ts`

- [ ] **Step 1: Write the failing CLI tests**

```ts
test('list prints accounts in order with the current marker', async () => {
  const output = await runCli(['list'], { appHome });
  expect(output).toContain('* alpha');
  expect(output).toContain('  beta');
});

test('empty managed run tells the user to add an account first', async () => {
  const output = await runCli([], { appHome, expectFailure: true });
  expect(output).toContain('codex-auto add <name>');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/cli/cli.test.ts`
Expected: FAIL because the CLI command layer is not implemented

- [ ] **Step 3: Implement the command entrypoints**

```ts
program
  .command('list')
  .action(listAccountsCommand);

program
  .command('add <name>')
  .action(addAccountCommand);

program
  .command('remove <name>')
  .action(removeAccountCommand);

program.action(runManagedSessionCommand);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/cli/cli.test.ts`
Expected: PASS

### Task 8: Full verification and documentation touch-up

**Files:**
- Modify: `docs/superpowers/memory/module-cards/repo-scope.md`
- Modify: `docs/superpowers/specs/2026-04-17-codex-auto-design.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS with all tests green

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: PASS and emit `dist/`

- [ ] **Step 3: Reconcile implementation details back into durable docs**

```md
- Record the final source layout in repository memory
- Note any design deviations discovered during implementation
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add codex-auto managed multi-account CLI"
```

Expected: In this workspace, skip the commit if the directory is still not a Git repository; keep the rest of the verification evidence.
