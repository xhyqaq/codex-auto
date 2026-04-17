import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { addAccount, removeAccount } from '../../src/lib/accounts.js';
import { loadState } from '../../src/lib/state.js';
import { createTempAppHome, cleanupTempDir, fileExists, seedAccount, seedState } from '../helpers/temp.js';

describe('account lifecycle', () => {
  test('addAccount appends a new account to the rotation list', async () => {
    const appHome = await createTempAppHome();
    try {
      await addAccount(appHome, 'alpha', async (accountHome) => {
        const authPath = path.join(accountHome, 'auth.json');
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(authPath, JSON.stringify({ account: 'alpha' }, null, 2), 'utf8')
        );
      });

      const state = await loadState(appHome);
      expect(state.accounts).toEqual(['alpha']);
      expect(await readFile(path.join(appHome, 'accounts', 'alpha', 'config.toml'), 'utf8')).toContain(
        'cli_auth_credentials_store = "file"'
      );
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('removeAccount deletes account data and keeps empty state valid', async () => {
    const appHome = await createTempAppHome();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['alpha'],
        currentIndex: 0,
        lastSuccessfulAccount: 'alpha',
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'alpha');

      await removeAccount(appHome, 'alpha');

      const state = await loadState(appHome);
      expect(state.accounts).toEqual([]);
      expect(fileExists(path.join(appHome, 'accounts', 'alpha'))).toBe(false);
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('addAccount imports manual config and auth files without running login', async () => {
    const appHome = await createTempAppHome();
    const importDir = await createTempAppHome('codex-auto-import-');
    try {
      const configPath = path.join(importDir, 'custom.toml');
      const authPath = path.join(importDir, 'auth.json');
      await writeFile(configPath, 'model = "gpt-5.4"\n', 'utf8');
      await writeFile(authPath, JSON.stringify({ account: 'manual', token: 'manual-token' }, null, 2), 'utf8');

      await addAccount(appHome, 'manual', {
        configPath,
        authPath,
        runLogin: async () => {
          throw new Error('login should not run when auth is imported');
        }
      });

      const state = await loadState(appHome);
      expect(state.accounts).toEqual(['manual']);
      expect(await readFile(path.join(appHome, 'accounts', 'manual', 'config.toml'), 'utf8')).toContain('model = "gpt-5.4"');
      expect(await readFile(path.join(appHome, 'accounts', 'manual', 'config.toml'), 'utf8')).toContain(
        'cli_auth_credentials_store = "file"'
      );
      expect(await readFile(path.join(appHome, 'accounts', 'manual', 'auth.json'), 'utf8')).toContain('manual-token');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(importDir);
    }
  });
});
