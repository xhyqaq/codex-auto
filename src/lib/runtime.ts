import { copyFileAtomic, ensureDir, pathExists, writeTextAtomic } from './fs.js';
import { buildRuntimeConfig } from './account-config.js';
import {
  accountAuthPath,
  accountHome,
  accountsRoot,
  logsRoot,
  runtimeAuthPath,
  runtimeConfigPath,
  runtimeHome
} from './paths.js';

export async function ensureAppLayout(appHome: string): Promise<void> {
  await Promise.all([
    ensureDir(appHome),
    ensureDir(accountsRoot(appHome)),
    ensureDir(runtimeHome(appHome)),
    ensureDir(logsRoot(appHome))
  ]);
}

export async function syncRuntimeAccount(appHome: string, accountName: string, _workspaceDir: string): Promise<void> {
  await ensureAppLayout(appHome);
  await ensureDir(accountHome(appHome, accountName));

  const sourceAuthPath = accountAuthPath(appHome, accountName);
  if (!(await pathExists(sourceAuthPath))) {
    throw new Error(`Account "${accountName}" has no auth.json. Run codex-auto add ${accountName} again.`);
  }

  await copyFileAtomic(sourceAuthPath, runtimeAuthPath(appHome));
  await writeTextAtomic(runtimeConfigPath(appHome), await buildRuntimeConfig(appHome, accountName));
}
