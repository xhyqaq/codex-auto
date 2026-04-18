# Account Bootstrap And Default Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. It will decide whether each batch should run in parallel or serial subagent mode and will pass only task-local context to each subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic `default` account bootstrapping from the source `CODEX_HOME` and a persistent default start account that controls the starting account for future managed runs.

**Architecture:** Extend `state.json` with a user-owned `preferredAccountName`, add a bootstrap path that seeds `default` when no managed accounts exist yet, and keep runtime rotation logic separate from that persistent preference. Expose the preference through a dedicated CLI command and list rendering, while preserving the existing one-shot `--account` override and quota-driven account rotation.

**Tech Stack:** TypeScript, Node.js, Commander, Vitest

---

### Task 1: Extend state semantics for persistent default start account

**Files:**
- Modify: `src/lib/state.ts`
- Test: `tests/accounts/accounts.test.ts`

- [ ] **Step 1: Write failing state tests for `preferredAccountName` normalization**

Add tests covering:

```ts
test('loadState defaults preferredAccountName to null for legacy state files', async () => {
  await seedState(appHome, {
    version: 1,
    accounts: ['a'],
    currentIndex: 0,
    lastSuccessfulAccount: 'a',
    updatedAt: new Date().toISOString()
  });

  await expect(loadState(appHome)).resolves.toMatchObject({
    preferredAccountName: null
  });
});

test('removeAccountFromState clears preferredAccountName when removing the last account', () => {
  const next = removeAccountFromState(
    {
      version: 1,
      accounts: ['a'],
      currentIndex: 0,
      preferredAccountName: 'a',
      lastSuccessfulAccount: 'a',
      lastSessionId: null,
      updatedAt: new Date().toISOString()
    },
    'a'
  );

  expect(next.preferredAccountName).toBeNull();
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `npm test -- --run tests/accounts/accounts.test.ts`

Expected: FAIL because `preferredAccountName` does not exist in the state schema yet.

- [ ] **Step 3: Implement `preferredAccountName` in state normalization**

Update `src/lib/state.ts` so:

- `AppState` includes `preferredAccountName: string | null`
- `createEmptyState()` initializes it to `null`
- `loadState()` treats missing legacy values as `null`
- when the account list becomes empty, both `currentIndex` and `preferredAccountName` normalize to `null`
- when `preferredAccountName` points to a removed account, normalize it to the first remaining account

- [ ] **Step 4: Re-run state tests**

Run: `npm test -- --run tests/accounts/accounts.test.ts`

Expected: PASS for the new normalization coverage.

- [ ] **Step 5: Commit state groundwork**

```bash
git add src/lib/state.ts tests/accounts/accounts.test.ts
git commit -m "feat: persist default start account in state"
```

### Task 2: Add account preference helpers and bootstrap support

**Files:**
- Modify: `src/lib/accounts.ts`
- Modify: `src/lib/paths.ts` only if a helper is needed for source-home auth/config access
- Test: `tests/accounts/accounts.test.ts`

- [ ] **Step 1: Write failing tests for first-account preference and bootstrap import**

Add tests covering:

```ts
test('addAccount sets preferredAccountName for the first account only', async () => {
  await addAccount(appHome, 'a', loginStub('a'));
  await addAccount(appHome, 'b', loginStub('b'));

  await expect(loadState(appHome)).resolves.toMatchObject({
    preferredAccountName: 'a'
  });
});

test('bootstrapDefaultAccount imports auth and config from source CODEX_HOME', async () => {
  await writeFile(path.join(codexHome, 'auth.json'), JSON.stringify({ token: 'seed' }), 'utf8');
  await writeFile(path.join(codexHome, 'config.toml'), 'model = \"gpt-5.4\"\n', 'utf8');

  await bootstrapDefaultAccount(appHome, codexHome);

  await expect(readFile(accountAuthPath(appHome, 'default'), 'utf8')).resolves.toContain('seed');
  await expect(readFile(accountConfigPath(appHome, 'default'), 'utf8')).resolves.toContain('gpt-5.4');
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `npm test -- --run tests/accounts/accounts.test.ts`

Expected: FAIL because the first account does not yet set `preferredAccountName` and no bootstrap helper exists.

- [ ] **Step 3: Implement minimal account helpers**

Update `src/lib/accounts.ts` to:

- set `preferredAccountName` when the very first account is added
- preserve an existing preference when later accounts are added
- export a helper such as `setPreferredAccount(appHome, name)`
- export a helper such as `bootstrapDefaultAccount(appHome, codexHome)` that:
  - exits early if accounts already exist
  - validates source `auth.json` exists and is non-empty
  - copies source `auth.json` into `accounts/default/auth.json`
  - copies source `config.toml` when present
  - initializes state with `accounts: ['default']`, `currentIndex: 0`, `preferredAccountName: 'default'`

- [ ] **Step 4: Re-run targeted account tests**

Run: `npm test -- --run tests/accounts/accounts.test.ts`

Expected: PASS for first-account preference and bootstrap import coverage.

- [ ] **Step 5: Commit account bootstrap helpers**

```bash
git add src/lib/accounts.ts tests/accounts/accounts.test.ts
git commit -m "feat: bootstrap default account from source codex home"
```

### Task 3: Route managed launches through bootstrap and preferred-account selection

**Files:**
- Modify: `src/lib/rotation.ts`
- Modify: `src/lib/session.ts`
- Modify: `src/cli.ts`
- Test: `tests/session/session.test.ts`
- Test: `tests/cli/cli.test.ts`

- [ ] **Step 1: Write failing tests for preferred selection and CLI bootstrap**

Add tests covering:

```ts
test('runManagedSession starts from preferredAccountName when no --account override is given', async () => {
  await seedState(appHome, {
    version: 1,
    accounts: ['a', 'b'],
    currentIndex: 0,
    preferredAccountName: 'b',
    lastSuccessfulAccount: null,
    lastSessionId: null,
    updatedAt: new Date().toISOString()
  });

  // run managed session and assert b auth is used first
});

test('runCli bootstraps default when no accounts exist but source CODEX_HOME has auth', async () => {
  // arrange empty appHome, source auth, run codex-auto
  // assert state contains default and launch proceeds
});

test('runCli use command persists preferred account', async () => {
  // arrange accounts, invoke `runCli(['use', 'b'])`
  // assert state.preferredAccountName === 'b'
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `npm test -- --run tests/session/session.test.ts tests/cli/cli.test.ts`

Expected: FAIL because startup still resolves from `currentIndex`, no `use` command exists, and bootstrap is not invoked from the CLI path.

- [ ] **Step 3: Implement selection and CLI changes**

Update the runtime path so that:

- `rotation.ts` can resolve `preferredAccountName` safely
- `runManagedSession()` starts from:
  - `preferredAccountName` when present
  - `currentIndex` otherwise
  - `--account` still overrides both
- quota-driven rotation still updates `currentIndex` and `lastSuccessfulAccount` only
- `cli.ts` invokes bootstrap before rejecting an empty account set
- `cli.ts` adds `use <name>` and persists the preference through the helper from Task 2
- `list` output can show both current pointer and preferred account

- [ ] **Step 4: Re-run targeted launch and CLI tests**

Run: `npm test -- --run tests/session/session.test.ts tests/cli/cli.test.ts`

Expected: PASS for bootstrap, preferred start, `--account` override, and `use` command coverage.

- [ ] **Step 5: Commit launch-path behavior**

```bash
git add src/lib/rotation.ts src/lib/session.ts src/cli.ts tests/session/session.test.ts tests/cli/cli.test.ts
git commit -m "feat: honor default start account in managed runs"
```

### Task 4: Update account removal and list rendering semantics

**Files:**
- Modify: `src/lib/accounts.ts`
- Test: `tests/accounts/accounts.test.ts`
- Test: `tests/cli/cli.test.ts`

- [ ] **Step 1: Write failing tests for removal fallback and list markers**

Add tests covering:

```ts
test('removeAccount falls back preferredAccountName to the first remaining account', async () => {
  await seedState(appHome, {
    version: 1,
    accounts: ['a', 'b'],
    currentIndex: 1,
    preferredAccountName: 'b',
    lastSuccessfulAccount: 'b',
    lastSessionId: null,
    updatedAt: new Date().toISOString()
  });

  await removeAccount(appHome, 'b');

  await expect(loadState(appHome)).resolves.toMatchObject({
    preferredAccountName: 'a'
  });
});

test('renderAccountList marks both current and default accounts', () => {
  expect(renderAccountList(state)).toContain('* a (default)');
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `npm test -- --run tests/accounts/accounts.test.ts tests/cli/cli.test.ts`

Expected: FAIL because removal does not yet repair the preference and list output does not include `(default)`.

- [ ] **Step 3: Implement list and removal rules**

Update:

- `removeAccountFromState()` to repair `preferredAccountName`
- `renderAccountList()` to append `(default)` on the preferred account row while retaining `*` for the current pointer

- [ ] **Step 4: Re-run targeted account/list tests**

Run: `npm test -- --run tests/accounts/accounts.test.ts tests/cli/cli.test.ts`

Expected: PASS for removal fallback and list output markers.

- [ ] **Step 5: Commit account UX updates**

```bash
git add src/lib/accounts.ts src/lib/state.ts tests/accounts/accounts.test.ts tests/cli/cli.test.ts
git commit -m "feat: expose default start account in account management"
```

### Task 5: Update product docs and run full verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Update README copy**

Document:

- first-run automatic `default` bootstrap
- `codex-auto use <name>` for changing the default start account
- how `--account` differs from the persistent default

- [ ] **Step 2: Run focused regression verification**

Run:

```bash
npm test -- --run tests/accounts/accounts.test.ts tests/session/session.test.ts tests/cli/cli.test.ts
npm run build
```

Expected:

- test output shows all targeted suites passing
- build exits with code `0`

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: all tests pass with `0` failures.

- [ ] **Step 4: Commit docs and verification-backed implementation**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: document default account bootstrap and preference"
```
