import { Writable } from 'node:stream';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { runCli, extractAccountOption, isOwnCommand } from '../../src/cli.js';
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
        preferredAccountName: 'beta',
        lastSuccessfulAccount: 'alpha',
        lastSessionId: null,
        retryAvailabilityByAccount: {
          alpha: {
            displayText: '11:10 PM',
            availableAt: '2099-04-18T23:10:00.000Z'
          }
        },
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
      expect(stdout.toString()).toContain('* alpha (retry at 11:10 PM)');
      expect(stdout.toString()).toContain('  beta (default)');
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('empty managed run tells the user to add an account first', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const stdout = new CaptureStream();
    try {
      const exitCode = await runCli([], {
        appHome,
        codexHome,
        stdout,
        stderr: stdout,
        stdin: process.stdin,
        interactive: false
      });

      expect(exitCode).toBe(1);
      expect(stdout.toString()).toContain('codex-auto add <name>');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('empty managed run bootstraps default from source CODEX_HOME when auth exists', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    const stdout = new CaptureStream();
    try {
      await mkdir(path.join(codexHome, 'sessions'), { recursive: true });
      await writeFile(path.join(codexHome, 'auth.json'), JSON.stringify({ account: 'default', token: 'seed-token' }, null, 2), 'utf8');
      await writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');
      await writeFile(path.join(codexHome, 'session_index.jsonl'), '', 'utf8');

      const exitCode = await runCli([], {
        appHome,
        codexHome,
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
      await expect(loadState(appHome)).resolves.toMatchObject({
        accounts: ['default'],
        preferredAccountName: 'default'
      });
      const records = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { authText: string });
      expect(records[0]?.authText).toContain('seed-token');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
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
        preferredAccountName: 'alpha',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        retryAvailabilityByAccount: {},
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

  test('managed run accepts --codex-home and persists session data into that source home', async () => {
    const appHome = await createTempAppHome();
    const codexHome = await createTempAppHome('codex-home-');
    const logPath = path.join(appHome, 'fake-codex.log');
    const stdout = new CaptureStream();
    try {
      await mkdir(path.join(codexHome, 'sessions'), { recursive: true });
      await writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4-mini"\n', 'utf8');
      await writeFile(path.join(codexHome, 'session_index.jsonl'), '', 'utf8');
      await seedState(appHome, {
        version: 1,
        accounts: ['beta'],
        currentIndex: 0,
        preferredAccountName: 'beta',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        retryAvailabilityByAccount: {},
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'beta', { account: 'b', token: 'b-token' });

      const exitCode = await runCli(['--codex-home', codexHome], {
        appHome,
        stdout,
        stderr: stdout,
        stdin: process.stdin,
        interactive: false,
        env: {
          ...process.env,
          CODEX_AUTO_CODEX_BIN: `node ${path.resolve(process.cwd(), 'tests/fixtures/fake-codex.mjs')}`,
          FAKE_CODEX_LOG: logPath,
          FAKE_CODEX_SESSION_ID: 'cli-session'
        }
      });

      expect(exitCode).toBe(0);
      expect(await readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8')).toContain('cli-session');
    } finally {
      await cleanupTempDir(appHome);
      await cleanupTempDir(codexHome);
    }
  });

  test('passthrough forwards extra args to codex', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    const stdout = new CaptureStream();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['beta'],
        currentIndex: 0,
        preferredAccountName: 'beta',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        retryAvailabilityByAccount: {},
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'beta', { account: 'b', token: 'b-token' });

      const exitCode = await runCli(['--model', 'o3', 'fix the bug'], {
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
      const records = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { args: string[] });
      expect(records[0]?.args).toContain('--model');
      expect(records[0]?.args).toContain('o3');
      expect(records[0]?.args).toContain('fix the bug');
      expect(records[0]?.args).toContain('--no-alt-screen');
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('passthrough with --account forwards remaining args to codex', async () => {
    const appHome = await createTempAppHome();
    const logPath = path.join(appHome, 'fake-codex.log');
    const stdout = new CaptureStream();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['alpha', 'beta'],
        currentIndex: 0,
        preferredAccountName: 'alpha',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        retryAvailabilityByAccount: {},
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'alpha', { account: 'a', token: 'a-token' });
      await seedAccount(appHome, 'beta', { account: 'b', token: 'b-token' });

      const exitCode = await runCli(['--account', 'beta', '--full-auto', 'refactor'], {
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
      const records = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { args: string[]; authText: string });
      expect(records[0]?.authText).toContain('"account": "b"');
      expect(records[0]?.args).toContain('--full-auto');
      expect(records[0]?.args).toContain('refactor');
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('use command persists the preferred account', async () => {
    const appHome = await createTempAppHome();
    const stdout = new CaptureStream();
    try {
      await seedState(appHome, {
        version: 1,
        accounts: ['alpha', 'beta'],
        currentIndex: 0,
        preferredAccountName: 'alpha',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        retryAvailabilityByAccount: {},
        updatedAt: '2026-04-17T00:00:00.000Z'
      });
      await seedAccount(appHome, 'alpha');
      await seedAccount(appHome, 'beta');

      const exitCode = await runCli(['use', 'beta'], {
        appHome,
        stdout,
        stderr: stdout,
        stdin: process.stdin,
        interactive: false
      });

      expect(exitCode).toBe(0);
      expect(stdout.toString()).toContain('Default start account set to beta');
      await expect(loadState(appHome)).resolves.toMatchObject({
        preferredAccountName: 'beta'
      });
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('passthrough does not add --no-alt-screen for exec subcommand', async () => {
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

      const exitCode = await runCli(['exec', 'fix the bug'], {
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
      const records = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { args: string[] });
      expect(records[0]?.args).toContain('exec');
      expect(records[0]?.args).toContain('fix the bug');
      expect(records[0]?.args).not.toContain('--no-alt-screen');
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

describe('extractAccountOption', () => {
  test('extracts --account and returns the rest', () => {
    const result = extractAccountOption(['--account', 'beta', '--model', 'o3', 'fix bug']);
    expect(result.accountName).toBe('beta');
    expect(result.rest).toEqual(['--model', 'o3', 'fix bug']);
  });

  test('returns undefined accountName when --account is absent', () => {
    const result = extractAccountOption(['exec', 'fix bug']);
    expect(result.accountName).toBeUndefined();
    expect(result.rest).toEqual(['exec', 'fix bug']);
  });

  test('handles empty argv', () => {
    const result = extractAccountOption([]);
    expect(result.accountName).toBeUndefined();
    expect(result.rest).toEqual([]);
  });

  test('handles --account at the end without a value', () => {
    const result = extractAccountOption(['exec', '--account']);
    expect(result.accountName).toBeUndefined();
    expect(result.rest).toEqual(['exec', '--account']);
  });
});

describe('isOwnCommand', () => {
  test('recognizes add as own command', () => {
    expect(isOwnCommand(['add', 'myaccount'])).toBe(true);
  });

  test('recognizes remove as own command', () => {
    expect(isOwnCommand(['remove', 'myaccount'])).toBe(true);
  });

  test('recognizes list as own command', () => {
    expect(isOwnCommand(['list'])).toBe(true);
  });

  test('recognizes --help as own command', () => {
    expect(isOwnCommand(['--help'])).toBe(true);
  });

  test('recognizes -h as own command', () => {
    expect(isOwnCommand(['-h'])).toBe(true);
  });

  test('treats empty args as passthrough', () => {
    expect(isOwnCommand([])).toBe(false);
  });

  test('treats codex subcommands as passthrough', () => {
    expect(isOwnCommand(['exec', 'fix bug'])).toBe(false);
    expect(isOwnCommand(['review'])).toBe(false);
  });

  test('treats prompt-only args as passthrough', () => {
    expect(isOwnCommand(['fix the login bug'])).toBe(false);
  });

  test('treats codex options as passthrough', () => {
    expect(isOwnCommand(['--model', 'o3', '--full-auto'])).toBe(false);
  });
});
