import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { runManagedSession } from '../../src/lib/session.js';
import { loadState } from '../../src/lib/state.js';
import { cleanupTempDir, createTempAppHome, seedAccount, seedState } from '../helpers/temp.js';

describe('managed session runner', () => {
  test('switches accounts and resumes with persisted session id after quota failure', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
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
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-123","继续"]');
      await expect(loadState(appHome)).resolves.toMatchObject({
        lastSessionId: 'session-123'
      });
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('starts from the requested account override', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
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
    }
  });

  test('switches accounts when the quota prompt appears before the process exits', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
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
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-456","继续"]');
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('reads session id from runtime session files when session_index is missing', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
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
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-from-file","继续"]');
      await expect(loadState(appHome)).resolves.toMatchObject({
        lastSessionId: 'session-from-file'
      });
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('ignores historical quota text that appears before the latest prompt on resume', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
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
      expect(logText).toContain('"args":["resume","--no-alt-screen","session-history","继续"]');
      await expect(loadState(appHome)).resolves.toMatchObject({
        currentIndex: 1,
        lastSuccessfulAccount: 'b'
      });
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('falls back to resume --last when persisted session id cannot be resumed', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'a', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'b', { account: 'b', token: 'b-token' });

      const result = await runManagedSession({
        appHome,
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
      expect(logText).toContain('"args":["resume","--no-alt-screen","missing-session","继续"]');
      expect(logText).toContain('"args":["resume","--last","--no-alt-screen"]');
    } finally {
      await cleanupTempDir(appHome);
    }
  });
});
