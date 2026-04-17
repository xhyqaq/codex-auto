import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { acquireRuntimeLock } from '../../src/lib/lock.js';
import { createTempAppHome, cleanupTempDir } from '../helpers/temp.js';

describe('runtime lock', () => {
  test('lock acquisition fails when a live pid already owns the runtime', async () => {
    const appHome = await createTempAppHome();
    try {
      const runtimeDir = path.join(appHome, 'runtime');
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(
        path.join(runtimeDir, '.lock'),
        JSON.stringify({ pid: process.pid, createdAt: '2026-04-17T00:00:00.000Z' }, null, 2),
        'utf8'
      );
      await expect(acquireRuntimeLock(appHome)).rejects.toThrow(/already running/i);
    } finally {
      await cleanupTempDir(appHome);
    }
  });
});
