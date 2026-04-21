import { readdir, symlink, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { copyFileAtomic, ensureDir, pathExists, writeTextAtomic } from './fs.js';
import {
  accountsRoot,
  instancesRoot,
  logsRoot,
  runsRoot
} from './paths.js';

export async function ensureAppLayout(appHome: string): Promise<void> {
  await Promise.all([
    ensureDir(appHome),
    ensureDir(accountsRoot(appHome)),
    ensureDir(instancesRoot(appHome)),
    ensureDir(logsRoot(appHome)),
    ensureDir(runsRoot(appHome))
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
  await ensureDir(codexHome);

  const persistentFileEntries = ['history.jsonl', 'session_index.jsonl'];
  for (const entry of persistentFileEntries) {
    const target = path.join(codexHome, entry);
    if (!(await pathExists(target))) {
      await writeTextAtomic(target, '');
    }
  }

  const sessionsDir = path.join(codexHome, 'sessions');
  if (!(await pathExists(sessionsDir))) {
    await ensureDir(sessionsDir);
  }

  const overlayEntries = new Set<string>(await readdir(codexHome));
  overlayEntries.delete('auth.json');
  // models_cache.json must not be symlinked: codex updates it with atomic writes
  // (temp file + rename) which replaces the symlink with a real file in the instance,
  // leaving the original permanently stale. Excluding it lets codex recreate it fresh
  // with the correct client_version each run.
  overlayEntries.delete('models_cache.json');

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

export async function replaceOverlayAuth(instanceDir: string, accountAuthPath: string): Promise<void> {
  if (!(await pathExists(accountAuthPath))) {
    throw new Error(`Missing auth.json at ${accountAuthPath}`);
  }

  await copyFileAtomic(accountAuthPath, path.join(instanceDir, 'auth.json'));
}
