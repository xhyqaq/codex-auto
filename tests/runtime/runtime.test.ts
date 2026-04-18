import path from 'node:path';
import { lstat, readFile, readlink, writeFile, mkdir } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { accountAuthPath, instanceHome } from '../../src/lib/paths.js';
import { cleanupInstanceOverlay, createInstanceOverlay } from '../../src/lib/runtime.js';
import { createTempAppHome, cleanupTempDir, seedAccount } from '../helpers/temp.js';

describe('runtime overlay', () => {
  test('createInstanceOverlay links codex home entries and copies account auth', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    try {
      await mkdir(path.join(codexHome, 'sessions'), { recursive: true });
      await writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4-mini"\n', 'utf8');
      await writeFile(path.join(codexHome, 'auth.json'), JSON.stringify({ account: 'source' }, null, 2), 'utf8');
      await seedAccount(appHome, 'alpha', { token: 'token', account: 'alpha' });
      const instanceDir = instanceHome(appHome, 'test-instance');

      await createInstanceOverlay(codexHome, instanceDir, accountAuthPath(appHome, 'alpha'));

      expect(await readFile(path.join(instanceDir, 'auth.json'), 'utf8')).toContain('token');
      expect((await lstat(path.join(instanceDir, 'config.toml'))).isSymbolicLink()).toBe(true);
      expect((await lstat(path.join(instanceDir, 'sessions'))).isSymbolicLink()).toBe(true);
      expect(await readlink(path.join(instanceDir, 'config.toml'))).toBe(path.join(codexHome, 'config.toml'));
      expect(await readlink(path.join(instanceDir, 'sessions'))).toBe(path.join(codexHome, 'sessions'));
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('cleanupInstanceOverlay removes the overlay directory recursively', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    try {
      await writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4-mini"\n', 'utf8');
      await seedAccount(appHome, 'alpha', { token: 'token', account: 'alpha' });
      const instanceDir = instanceHome(appHome, 'cleanup-instance');

      await createInstanceOverlay(codexHome, instanceDir, accountAuthPath(appHome, 'alpha'));
      await cleanupInstanceOverlay(instanceDir);

      await expect(lstat(instanceDir)).rejects.toThrow();
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });
});
