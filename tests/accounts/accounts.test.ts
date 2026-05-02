import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { addAccount, bootstrapDefaultAccount, removeAccount, renderAccountList } from '../../src/lib/accounts.js';
import { accountAuthPath, accountConfigPath } from '../../src/lib/paths.js';
import { loadState, removeAccountFromState } from '../../src/lib/state.js';
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
      expect(state.preferredAccountName).toBe('alpha');
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
        preferredAccountName: 'alpha',
        lastSuccessfulAccount: 'alpha',
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'alpha');

      await removeAccount(appHome, 'alpha');

      const state = await loadState(appHome);
      expect(state.accounts).toEqual([]);
      expect(state.preferredAccountName).toBeNull();
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
      expect(state.preferredAccountName).toBe('manual');
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

  test('loadState defaults preferredAccountName to null for legacy state files', async () => {
    const appHome = await createTempAppHome();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['alpha'],
        currentIndex: 0,
        lastSuccessfulAccount: 'alpha',
        updatedAt: '2026-04-17T00:00:00.000Z'
      });

      await expect(loadState(appHome)).resolves.toMatchObject({
        preferredAccountName: null
      });
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('removeAccountFromState clears preferredAccountName when removing the last account', () => {
    const next = removeAccountFromState(
      {
        version: 1,
        accounts: ['alpha'],
        currentIndex: 0,
        preferredAccountName: 'alpha',
        lastSuccessfulAccount: 'alpha',
        lastSessionId: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      },
      'alpha'
    );

    expect(next.preferredAccountName).toBeNull();
  });

  test('addAccount keeps the first account as preferred by default', async () => {
    const appHome = await createTempAppHome();
    try {
      await addAccount(appHome, 'alpha', async (accountHome) => {
        const authPath = path.join(accountHome, 'auth.json');
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(authPath, JSON.stringify({ account: 'alpha' }, null, 2), 'utf8')
        );
      });
      await addAccount(appHome, 'beta', async (accountHome) => {
        const authPath = path.join(accountHome, 'auth.json');
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(authPath, JSON.stringify({ account: 'beta' }, null, 2), 'utf8')
        );
      });

      await expect(loadState(appHome)).resolves.toMatchObject({
        accounts: ['alpha', 'beta'],
        preferredAccountName: 'alpha'
      });
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('bootstrapDefaultAccount imports auth and config from source CODEX_HOME', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    try {
      await writeFile(path.join(codexHome, 'auth.json'), JSON.stringify({ account: 'default', token: 'seed' }, null, 2), 'utf8');
      await writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');

      await bootstrapDefaultAccount(appHome, codexHome);

      await expect(readFile(accountAuthPath(appHome, 'default'), 'utf8')).resolves.toContain('seed');
      await expect(readFile(accountConfigPath(appHome, 'default'), 'utf8')).resolves.toContain('gpt-5.4');
      await expect(loadState(appHome)).resolves.toMatchObject({
        accounts: ['default'],
        currentIndex: 0,
        preferredAccountName: 'default'
      });
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('removeAccount falls back preferredAccountName to the first remaining account', async () => {
    const appHome = await createTempAppHome();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['alpha', 'beta'],
        currentIndex: 1,
        preferredAccountName: 'beta',
        lastSuccessfulAccount: 'beta',
        lastSessionId: null,
        retryAvailabilityByAccount: {
          beta: {
            displayText: '11:10 PM',
            availableAt: '2099-04-18T23:10:00.000Z'
          }
        },
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'alpha');
      await seedAccount(appHome, 'beta');

      await removeAccount(appHome, 'beta');

      await expect(loadState(appHome)).resolves.toMatchObject({
        accounts: ['alpha'],
        preferredAccountName: 'alpha',
        retryAvailabilityByAccount: {}
      });
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('renderAccountList shows current marker and retry availability', () => {
    const output = renderAccountList({
      version: 1,
      accounts: ['alpha', 'beta'],
      currentIndex: 0,
      preferredAccountName: 'alpha',
      lastSuccessfulAccount: null,
      lastSessionId: null,
      retryAvailabilityByAccount: {
        alpha: {
          displayText: '11:10 PM',
          availableAt: '2099-04-18T23:10:00.000Z'
        }
      },
      updatedAt: '2026-04-18T00:00:00.000Z'
    });

    expect(output).toContain('* alpha (retry at 11:10 PM)');
    expect(output).toContain('  beta');
    expect(output).not.toContain('default');
  });
});
