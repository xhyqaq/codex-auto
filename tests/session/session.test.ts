import path from 'node:path';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { instancesRoot } from '../../src/lib/paths.js';
import { runManagedSession } from '../../src/lib/session.js';
import { loadState } from '../../src/lib/state.js';
import { cleanupTempDir, createTempAppHome, seedAccount, seedState } from '../helpers/temp.js';

async function seedCodexHome(codexHome: string): Promise<void> {
  await mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  await writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4-mini"\n', 'utf8');
  await writeFile(path.join(codexHome, 'session_index.jsonl'), '', 'utf8');
}

class TtyCaptureStream extends Writable {
  override isTTY = true;
  override columns = 120;
  override rows = 40;
  private readonly chunks: string[] = [];

  text(): string {
    return this.chunks.join('');
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }
}

class TtyInputStream extends PassThrough {
  override isTTY = true;
  public rawModeCalls: boolean[] = [];
  public isRaw = false;

  setRawMode(value: boolean): this {
    this.rawModeCalls.push(value);
    this.isRaw = value;
    return this;
  }
}

describe('managed session runner', () => {
  test('switches accounts and resumes with persisted session id after quota failure', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'session-123'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-123","Continue"]');
      expect(await readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8')).toContain('session-123');
      await expect(readdir(instancesRoot(appHome))).resolves.toEqual([]);
      await expect(loadState(appHome)).resolves.toMatchObject({
        lastSessionId: 'session-123',
        retryAvailabilityByAccount: {
          a: {
            displayText: '11:10 PM'
          }
        }
      });
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('switches accounts when codex emits the current upgrade quota prompt', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'session-upgrade-prompt',
          FAKE_CODEX_QUOTA_MESSAGE_VARIANT: 'upgrade',
          FAKE_CODEX_PRIMARY_RETRY_AT: '6:42 PM'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-upgrade-prompt","Continue"]');
      await expect(loadState(appHome)).resolves.toMatchObject({
        lastSessionId: 'session-upgrade-prompt',
        retryAvailabilityByAccount: {
          a: {
            displayText: '6:42 PM'
          }
        }
      });
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('starts from the requested account override', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        preferredAccountName: 'b',
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath
        },
        interactive: false
      });

      expect(result.switchCount).toBe(0);
      expect(result.finalAccount).toBe('b');

      const records = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { authText: string });
      expect(records[0]?.authText).toContain('"account": "b"');
      expect(records[0]?.authText).not.toContain('"account": "a"');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('switches accounts when the quota prompt appears before the process exits', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_WAIT_ON_QUOTA: '1',
          FAKE_CODEX_SESSION_ID: 'session-456'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-456","Continue"]');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('reads session id from runtime session files when session_index is missing', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await mkdir(path.join(codexHome, 'sessions'), { recursive: true });
      await writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4-mini"\n', 'utf8');
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'session-from-file',
          FAKE_CODEX_SKIP_SESSION_INDEX: '1'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-from-file","Continue"]');
      await expect(loadState(appHome)).resolves.toMatchObject({
        lastSessionId: 'session-from-file'
      });
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('keeps the current run bound to its own session when a competing same-workspace session writes a newer record', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'session-owned',
          FAKE_CODEX_COMPETING_SESSION_ID: 'session-competing',
          FAKE_CODEX_COMPETING_SESSION_CWD: process.cwd()
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-owned","Continue"]');
      expect(logText).not.toContain('"args":["resume","--no-alt-screen","session-competing","Continue"]');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('keeps the current run bound to its own session when a competing cross-workspace session writes a newer record', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'session-project-a',
          FAKE_CODEX_COMPETING_SESSION_ID: 'session-project-b',
          FAKE_CODEX_COMPETING_SESSION_CWD: '/tmp/another-project'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-project-a","Continue"]');
      expect(logText).not.toContain('"args":["resume","--no-alt-screen","session-project-b","Continue"]');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('ignores historical quota text that appears before the latest prompt on first launch', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['plus'],
        currentIndex: 0,
        preferredAccountName: 'plus',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'plus', { account: 'plus', token: 'plus-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_REPLAY_OLD_QUOTA_BEFORE_PROMPT: '1',
          FAKE_CODEX_OLD_RETRY_AT: '4:06 PM'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(0);
      expect(result.finalAccount).toBe('plus');
      expect(result.exhaustedAll).toBe(false);
      await expect(loadState(appHome)).resolves.toMatchObject({
        currentIndex: 0,
        lastSuccessfulAccount: 'plus',
        retryAvailabilityByAccount: {}
      });
      await expect(readFile(logPath, 'utf8')).resolves.not.toContain('"args":["resume"');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('ignores historical quota text that appears before the latest prompt on resume', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'session-history',
          FAKE_CODEX_RESUME_REPLAYS_OLD_QUOTA: '1'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');
      expect(result.exhaustedAll).toBe(false);

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-history","Continue"]');
      await expect(loadState(appHome)).resolves.toMatchObject({
        currentIndex: 1,
        lastSuccessfulAccount: 'b'
      });
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('does not treat a stale replayed prompt plus delayed old quota text as a fresh resume quota', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'session-live-prompt',
          FAKE_CODEX_PRIMARY_RETRY_AT: '7:37 PM',
          FAKE_CODEX_RESUME_REPLAYS_STALE_QUOTA_BEFORE_LIVE_PROMPT: '1',
          FAKE_CODEX_OLD_RETRY_AT: '7:37 PM',
          FAKE_CODEX_REPLAY_OLD_QUOTA_DELAY_MS: '500',
          FAKE_CODEX_LIVE_PROMPT_DELAY_MS: '1800'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');
      expect(result.exhaustedAll).toBe(false);
      expect(result.exitCode).toBe(0);
      await expect(loadState(appHome)).resolves.toMatchObject({
        currentIndex: 1,
        lastSuccessfulAccount: 'b',
        retryAvailabilityByAccount: {
          a: {
            displayText: '7:37 PM'
          }
        }
      });
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('records retry time from the latest quota prompt instead of replayed historical output on resume', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'session-retry-current',
          FAKE_CODEX_PRIMARY_RETRY_AT: '7:37 PM',
          FAKE_CODEX_REPLAY_OLD_QUOTA_BEFORE_PROMPT: '1',
          FAKE_CODEX_OLD_RETRY_AT: '7:37 PM',
          FAKE_CODEX_EMIT_QUOTA_AFTER_PROMPT: '1',
          FAKE_CODEX_CURRENT_RETRY_AT: '4:06 PM'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');
      expect(result.exhaustedAll).toBe(true);
      await expect(loadState(appHome)).resolves.toMatchObject({
        retryAvailabilityByAccount: {
          a: {
            displayText: '7:37 PM'
          },
          b: {
            displayText: '4:06 PM'
          }
        }
      });
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('fails safely instead of falling back to resume --last when the bound session id cannot be resumed', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    const stderr = new PassThrough();
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'missing-session',
          FAKE_CODEX_FAIL_SESSION_ID: '1'
        },
        stderr,
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');
      expect(result.exitCode).not.toBe(0);

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","missing-session","Continue"]');
      expect(logText).not.toContain('"args":["resume","--last","--no-alt-screen"]');
      expect(stderr.read()?.toString() ?? '').toContain('Unable to safely resume bound session');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('interactive mode defaults to a non-script transport', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const helperHome = await createTempAppHome('shell-helper-');
    const shellLogPath = path.join(helperHome, 'shell.log');
    const fakeShellPath = path.join(helperHome, 'fake-shell.mjs');
    const stdout = new TtyCaptureStream();
    const stderr = new TtyCaptureStream();
    const stdin = new TtyInputStream() as TtyInputStream & NodeJS.ReadStream;

    try {
      await writeFile(
        fakeShellPath,
        `#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const parent = execFileSync('ps', ['-o', 'comm=', '-p', String(process.ppid)], { encoding: 'utf8' }).trim();
writeFileSync(${JSON.stringify(shellLogPath)}, \`\${parent}|\${process.argv.slice(2).join(' ')}\\n\`, 'utf8');
process.exit(0);
`,
        'utf8'
      );
      await chmod(fakeShellPath, 0o755);
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['b'],
        currentIndex: 0,
        preferredAccountName: 'b',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: 'codex',
        env: {
          ...process.env,
          SHELL: fakeShellPath
        },
        stdin,
        stdout,
        stderr,
        interactive: true
      });

      expect(result.exitCode).toBe(0);
      await expect(readFile(shellLogPath, 'utf8')).resolves.toMatch(/^node.*\|-lc codex '--no-alt-screen'/);
      expect(stdin.rawModeCalls).toEqual([true, false]);
    } finally {
      stdin.end();
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
      await cleanupTempDir(helperHome);
    }
  });

  test('interactive mode still rotates accounts after a quota error', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex-interactive.log');
    const stdout = new TtyCaptureStream();
    const stderr = new TtyCaptureStream();
    const stdin = new TtyInputStream() as TtyInputStream & NodeJS.ReadStream;

    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'interactive-session'
        },
        stdin,
        stdout,
        stderr,
        interactive: true
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');
      expect(stdin.rawModeCalls).toEqual([true, false, true, false]);
      await expect(readFile(logPath, 'utf8')).resolves.toContain(
        '"args":["resume","--no-alt-screen","interactive-session","Continue"]'
      );
      await expect(loadState(appHome)).resolves.toMatchObject({
        currentIndex: 1,
        preferredAccountName: 'a',
        lastSuccessfulAccount: 'b',
        retryAvailabilityByAccount: {
          a: {
            displayText: '11:10 PM'
          }
        }
      });
    } finally {
      stdin.end();
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('interactive mode waits briefly for the bound session id to be persisted before rotating', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex-interactive.log');
    const stdout = new TtyCaptureStream();
    const stderr = new TtyCaptureStream();
    const stdin = new TtyInputStream() as TtyInputStream & NodeJS.ReadStream;

    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'interactive-delayed-session',
          FAKE_CODEX_DELAY_SESSION_WRITE_MS: '150',
          FAKE_CODEX_WAIT_ON_QUOTA: '1'
        },
        stdin,
        stdout,
        stderr,
        interactive: true
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');
      await expect(readFile(logPath, 'utf8')).resolves.toContain(
        '"args":["resume","--no-alt-screen","interactive-delayed-session","Continue"]'
      );
      await expect(loadState(appHome)).resolves.toMatchObject({
        lastSessionId: 'interactive-delayed-session'
      });
    } finally {
      stdin.end();
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('non-interactive mode waits briefly for the bound session id to be persisted before rotating', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex-non-interactive.log');
    const stderr = new PassThrough();

    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'non-interactive-delayed-session',
          FAKE_CODEX_DELAY_SESSION_WRITE_MS: '200',
          FAKE_CODEX_WAIT_ON_QUOTA: '1'
        },
        stderr,
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');
      await expect(readFile(logPath, 'utf8')).resolves.toContain(
        '"args":["resume","--no-alt-screen","non-interactive-delayed-session","Continue"]'
      );
      await expect(loadState(appHome)).resolves.toMatchObject({
        lastSessionId: 'non-interactive-delayed-session'
      });
      expect(stderr.read()?.toString() ?? '').not.toContain('Unable to safely resume bound session');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('interactive mode restores terminal modes before returning control after a forced quota stop', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const stdout = new TtyCaptureStream();
    const stderr = new TtyCaptureStream();
    const stdin = new TtyInputStream() as TtyInputStream & NodeJS.ReadStream;

    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_ENABLE_TTY_MODES: '1',
          FAKE_CODEX_ENABLE_CSI_U_MODE: '1',
          FAKE_CODEX_WAIT_ON_QUOTA: '1'
        },
        stdin,
        stdout,
        stderr,
        interactive: true
      });

      expect(result.exhaustedAll).toBe(true);
      expect(stdout.text()).toContain('\u001b[?2004l');
      expect(stdout.text()).toContain('\u001b[>4;0m');
      expect(stdout.text()).toContain('\u001b[?1l');
      expect(stdout.text()).toContain('\u001b[<u');
    } finally {
      stdin.end();
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('interactive mode treats Ctrl-C during a quota prompt as a user interrupt instead of exhausting accounts', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const stdout = new TtyCaptureStream();
    const stderr = new TtyCaptureStream();
    const stdin = new TtyInputStream() as TtyInputStream & NodeJS.ReadStream;

    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });

      setTimeout(() => {
        stdin.write('\u0003');
      }, 100);

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_ENABLE_TTY_MODES: '1',
          FAKE_CODEX_WAIT_ON_QUOTA: '1'
        },
        stdin,
        stdout,
        stderr,
        interactive: true
      });

      expect(result.exhaustedAll).toBe(false);
      expect(stderr.text()).not.toContain('All configured accounts are exhausted');
      expect(stderr.text()).not.toContain('and resuming');
      expect(stdout.text()).toContain('\u001b[?2004l');
      expect(stdout.text()).toContain('\u001b[>4;0m');
    } finally {
      stdin.end();
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('starts from preferredAccountName when no per-run override is given', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        preferredAccountName: 'b',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath
        },
        interactive: false
      });

      expect(result.switchCount).toBe(0);
      expect(result.finalAccount).toBe('b');

      const records = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { authText: string });
      expect(records[0]?.authText).toContain('"account": "b"');
      expect(records[0]?.authText).not.toContain('"account": "a"');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('successful runs clear stale retry availability for the account', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedCodexHome(codexHome);
      await seedState(appHome, {
        version: 1,
        accounts: ['b'],
        currentIndex: 0,
        preferredAccountName: 'b',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        retryAvailabilityByAccount: {
          b: {
            displayText: '11:10 PM',
            availableAt: '2099-04-18T23:10:00.000Z'
          }
        },
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
        codexHome,
        workspaceDir: process.cwd(),
        codexCommand: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
        env: {
          ...process.env,
          FAKE_CODEX_LOG: logPath
        },
        interactive: false
      });

      expect(result.exitCode).toBe(0);
      await expect(loadState(appHome)).resolves.toMatchObject({
        retryAvailabilityByAccount: {}
      });
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });
});
