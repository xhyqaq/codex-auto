import { readdir, symlink, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, pathExists } from './fs.js';
import {
  accountsRoot,
  instancesRoot,
  logsRoot
} from './paths.js';

export async function ensureAppLayout(appHome: string): Promise<void> {
  await Promise.all([
    ensureDir(appHome),
    ensureDir(accountsRoot(appHome)),
    ensureDir(instancesRoot(appHome)),
    ensureDir(logsRoot(appHome))
  ]);
}

export async function createInstanceOverlay(
  codexHome: string,
  instanceDir: string,
  accountAuthPath: string
): Promise<void> {
  if (!(await pathExists(accountAuthPath))) {
    throw new Error(`Missing auth.json at ${accountAuthPath}`);
  }

  await ensureDir(instanceDir);

  const overlayEntries = new Set<string>([
    'config.toml',
    'history.jsonl',
    'session_index.jsonl',
    'sessions'
  ]);

  if (await pathExists(codexHome)) {
    const entries = await readdir(codexHome);
    for (const entry of entries) {
      overlayEntries.add(entry);
    }
  }

  overlayEntries.delete('auth.json');

  for (const entry of overlayEntries) {
    const target = path.join(codexHome, entry);
    const link = path.join(instanceDir, entry);
    await symlink(target, link);
  }

  await copyFile(accountAuthPath, path.join(instanceDir, 'auth.json'));
}

export async function cleanupInstanceOverlay(instanceDir: string): Promise<void> {
  await rm(instanceDir, { recursive: true, force: true });
}
