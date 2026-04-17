import { Writable } from 'node:stream';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli.js';
import { loadState } from '../../src/lib/state.js';
import { cleanupTempDir, createTempAppHome, seedAccount, seedState } from '../helpers/temp.js';

class CaptureStream extends Writable {
  public chunks: string[] = [];

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  toString(): string {
    return this.chunks.join('');
  }
}

describe('cli', () => {
  test('list prints accounts in order with the current marker', async () => {
    const appHome = await createTempAppHome();
    const stdout = new CaptureStream();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['alpha', 'beta'],
        currentIndex: 0,
        lastSuccessfulAccount: 'alpha',
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'alpha');
      await seedAccount(appHome, 'beta');

      const exitCode = await runCli(['list'], {
        appHome,
        stdout,
        stderr: stdout,
        stdin: process.stdin,
        interactive: false
      });

      expect(exitCode).toBe(0);
      expect(stdout.toString()).toContain('* alpha');
      expect(stdout.toString()).toContain('  beta');
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('empty managed run tells the user to add an account first', async () => {
    const appHome = await createTempAppHome();
    const stdout = new CaptureStream();
    try {
      const exitCode = await runCli([], {
        appHome,
        stdout,
        stderr: stdout,
        stdin: process.stdin,
        interactive: false
      });

      expect(exitCode).toBe(1);
      expect(stdout.toString()).toContain('codex-auto add <name>');
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('add imports manual config and auth files from cli flags', async () => {
    const appHome = await createTempAppHome();
    const importDir = await createTempAppHome('codex-auto-import-');
    const stdout = new CaptureStream();
    try {
      const configPath = path.join(importDir, 'custom.toml');
      const authPath = path.join(importDir, 'auth.json');
      await writeFile(configPath, 'model = "gpt-5.4-mini"\n', 'utf8');
      await writeFile(authPath, JSON.stringify({ account: 'cli', token: 'cli-token' }, null, 2), 'utf8');

      const exitCode = await runCli(['add', 'gamma', '--config', configPath, '--auth', authPath], {
        appHome,
        stdout,
        stderr: stdout,
        stdin: process.stdin,
        interactive: false
      });

      expect(exitCode).toBe(0);
      expect(stdout.toString()).toContain('Added account gamma');
      expect((await loadState(appHome)).accounts).toEqual(['gamma']);
      expect(await readFile(path.join(appHome, 'accounts', 'gamma', 'config.toml'), 'utf8')).toContain(
        'model = "gpt-5.4-mini"'
      );
      expect(await readFile(path.join(appHome, 'accounts', 'gamma', 'auth.json'), 'utf8')).toContain('cli-token');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(importDir);
    }
  });

  test('managed run can start from a requested account', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    const stdout = new CaptureStream();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['alpha', 'beta'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'alpha', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'beta', { account: 'b', token: 'b-token' });

      const exitCode = await runCli(['--account', 'beta'], {
        appHome,
        stdout,
        stderr: stdout,
        stdin: process.stdin,
        interactive: false,
        env: {
          ...process.env,
          CODEX_AUTO_CODEX_BIN: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
          FAKE_CODEX_LOG: logPath
        }
      });

      expect(exitCode).toBe(0);
      expect((await loadState(appHome)).currentIndex).toBe(1);
      const records = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { authText: string });
      expect(records[0]?.authText).toContain('"account": "b"');
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('managed run auto-falls back to non-interactive mode when stdio is not a tty', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    const stdout = new CaptureStream();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['beta'],
        currentIndex: 0,
        lastSuccessfulAccount: null,
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'beta', { account: 'b', token: 'b-token' });

      const exitCode = await runCli([], {
        appHome,
        stdout,
        stderr: stdout,
        stdin: process.stdin,
        env: {
          ...process.env,
          CODEX_AUTO_CODEX_BIN: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
          FAKE_CODEX_LOG: logPath
        }
      });

      expect(exitCode).toBe(0);
      expect(stdout.toString()).not.toContain('tcgetattr/ioctl');
      const records = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { authText: string });
      expect(records[0]?.authText).toContain('"account": "b"');
    } finally {
      await cleanupTempDir(appHome);
    }
  });
});
