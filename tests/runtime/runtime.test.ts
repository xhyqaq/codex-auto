import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { syncRuntimeAccount } from '../../src/lib/runtime.js';
import { createTempAppHome, cleanupTempDir, seedAccount } from '../helpers/temp.js';

describe('runtime sync', () => {
  test('syncRuntimeAccount copies auth and writes merged runtime config', async () => {
    const appHome = await createTempAppHome();
    try {
      await seedAccount(appHome, 'alpha', { token: 'token', account: 'alpha' });
      await syncRuntimeAccount(appHome, 'alpha', process.cwd());
      expect(await readFile(path.join(appHome, 'runtime', 'auth.json'), 'utf8')).toContain('token');
      expect(await readFile(path.join(appHome, 'runtime', 'config.toml'), 'utf8')).toContain(
        'cli_auth_credentials_store = "file"'
      );
    } finally {
      await cleanupTempDir(appHome);
    }
  });
});
