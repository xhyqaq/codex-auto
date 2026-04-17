import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('package distribution', () => {
  test('packs only release files and exposes publishable metadata', async () => {
    const packageJson = (await import('../../package.json', { with: { type: 'json' } })).default as {
      private?: boolean;
      license?: string;
      repository?: unknown;
      files?: string[];
      scripts?: Record<string, string>;
      engines?: Record<string, string>;
    };

    expect(packageJson.private).not.toBe(true);
    expect(packageJson.license).toBeTruthy();
    expect(packageJson.repository).toBeTruthy();
    expect(packageJson.engines?.node).toBeTruthy();
    expect(packageJson.scripts?.prepare).toBeTruthy();
    expect(packageJson.scripts?.prepack).toBeTruthy();
    expect(packageJson.files).toEqual(['dist', 'README.md', 'LICENSE']);

    const packDir = await mkdtemp(path.join(tmpdir(), 'codex-auto-pack-'));
    tempDirs.push(packDir);

    const { stdout } = await execFileAsync(
      'npm',
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: process.cwd(),
        env: process.env
      }
    );

    const [{ files }] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const packedPaths = files.map((file) => file.path).sort();

    expect(packedPaths).toContain('package.json');
    expect(packedPaths).toContain('README.md');
    expect(packedPaths).toContain('LICENSE');
    expect(packedPaths).toContain('dist/index.js');
    expect(packedPaths.some((entry) => entry.startsWith('src/'))).toBe(false);
    expect(packedPaths.some((entry) => entry.startsWith('tests/'))).toBe(false);
    expect(packedPaths.some((entry) => entry.startsWith('docs/'))).toBe(false);
    expect(packedPaths).not.toContain('tsconfig.json');
    expect(packedPaths).not.toContain('vitest.config.ts');
  });
});
