import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function createTempAppHome(prefix = 'codex-auto-'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function seedAccount(appHome: string, name: string, auth: unknown = { account: name }): Promise<void> {
  const accountDir = path.join(appHome, 'accounts', name);
  await mkdir(accountDir, { recursive: true });
  await writeFile(path.join(accountDir, 'auth.json'), JSON.stringify(auth, null, 2), 'utf8');
  await writeFile(path.join(accountDir, 'config.toml'), 'cli_auth_credentials_store = "file"\n', 'utf8');
}

export async function seedState(appHome: string, state: unknown): Promise<void> {
  await mkdir(appHome, { recursive: true });
  await writeFile(path.join(appHome, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
}

export async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}
