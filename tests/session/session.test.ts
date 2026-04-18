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

  override _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
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

  test('falls back to resume --last when persisted session id cannot be resumed', async () => {
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
          FAKE_CODEX_SESSION_ID: 'missing-session',
          FAKE_CODEX_FAIL_SESSION_ID: '1'
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--no-alt-screen","missing-session","Continue"]');
      expect(logText).toContain('"args":["resume","--last","--no-alt-screen"]');
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
