import { ensureAccountConfig } from './account-config.js';
import { copyFileAtomic, pathExists, removePathIfExists, writeJsonAtomic } from './fs.js';
import { runCodexLogin, resolveCodexCommand } from './codex-bin.js';
import { accountAuthPath, accountConfigPath, accountHome, accountMetaPath } from './paths.js';
import { loadState, removeAccountFromState, saveState, type AppState } from './state.js';
import { ensureAppLayout } from './runtime.js';

export type LoginRunner = (accountHome: string) => Promise<void>;
export type AddAccountOptions = {
  runLogin?: LoginRunner;
  configPath?: string;
  authPath?: string;
};

type AccountMeta = {
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

function assertAccountName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('Account names may only contain letters, numbers, dot, underscore, and dash');
  }
}

async function writeAccountMeta(appHome: string, name: string, partial: Partial<AccountMeta>): Promise<void> {
  const existing: AccountMeta = {
    name,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    ...partial
  };

  await writeJsonAtomic(accountMetaPath(appHome, name), existing);
}

function normalizeAddAccountOptions(options?: LoginRunner | AddAccountOptions): AddAccountOptions {
  if (!options) {
    return {};
  }

  if (typeof options === 'function') {
    return {
      runLogin: options
    };
  }

  return options;
}

export async function addAccount(
  appHome: string,
  name: string,
  options?: LoginRunner | AddAccountOptions
): Promise<void> {
  assertAccountName(name);
  await ensureAppLayout(appHome);
  const normalizedOptions = normalizeAddAccountOptions(options);
  const runLogin =
    normalizedOptions.runLogin ??
    (async (accountDir: string) => {
      await runCodexLogin({
        accountHome: accountDir,
        cwd: process.cwd(),
        codexCommand: resolveCodexCommand(process.env)
      });
    });

  const state = await loadState(appHome);
  if (state.accounts.includes(name)) {
    throw new Error(`Account "${name}" already exists`);
  }

  const targetHome = accountHome(appHome, name);

  try {
    if (normalizedOptions.configPath) {
      await copyFileAtomic(normalizedOptions.configPath, accountConfigPath(appHome, name));
    }

    await ensureAccountConfig(appHome, name);

    const authPath = accountAuthPath(appHome, name);
    if (normalizedOptions.authPath) {
      await copyFileAtomic(normalizedOptions.authPath, authPath);
    }

    if (!(await pathExists(authPath))) {
      await runLogin(targetHome);
    }

    const authFile = await import('node:fs/promises').then((fs) => fs.readFile(authPath, 'utf8')).catch(() => null);
    if (!authFile?.trim()) {
      throw new Error(`Login completed but no auth.json was written for account "${name}"`);
    }

    state.accounts.push(name);
    if (state.currentIndex === null) {
      state.currentIndex = 0;
    }
    await saveState(appHome, state);
    await writeAccountMeta(appHome, name, { name });
  } catch (error) {
    await removePathIfExists(targetHome);
    throw error;
  }
}

export async function removeAccount(appHome: string, name: string): Promise<void> {
  await ensureAppLayout(appHome);
  const state = await loadState(appHome);
  if (!state.accounts.includes(name)) {
    throw new Error(`Account "${name}" does not exist`);
  }

  await removePathIfExists(accountHome(appHome, name));
  await saveState(appHome, removeAccountFromState(state, name));
}

export function renderAccountList(state: AppState): string {
  if (state.accounts.length === 0) {
    return 'No accounts configured. Use `codex-auto add <name>` first.';
  }

  return state.accounts
    .map((account, index) => `${state.currentIndex === index ? '*' : ' '} ${account}`)
    .join('\n');
}

export async function markAccountUsed(appHome: string, name: string): Promise<void> {
  await writeAccountMeta(appHome, name, {
    name,
    lastUsedAt: new Date().toISOString()
  });
}
