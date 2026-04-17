import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { runManagedSession } from '../../src/lib/session.js';
import { cleanupTempDir, createTempAppHome, seedAccount, seedState } from '../helpers/temp.js';

describe('managed session runner', () => {
  test('switches accounts and resumes with 继续 after quota failure', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['a', 'b'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
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
          FAKE_CODEX_LOG: logPath
        },
        interactive: false
      });

      expect(result.switchCount).toBe(1);
      expect(result.finalAccount).toBe('b');

      const logText = await readFile(logPath, 'utf8');
      expect(logText).toContain('"args":["resume","--last","--no-alt-screen","继续"]');
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
});
