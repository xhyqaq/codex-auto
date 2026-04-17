import { z } from 'zod';
import { readTextIfExists, writeJsonAtomic } from './fs.js';
import { statePath } from './paths.js';

const appStateSchema = z.object({
  version: z.literal(1),
  accounts: z.array(z.string()),
  currentIndex: z.number().int().nonnegative().nullable(),
  lastSuccessfulAccount: z.string().nullable(),
  updatedAt: z.string()
});

export type AppState = z.infer<typeof appStateSchema>;

export function createEmptyState(): AppState {
  return {
    version: 1,
    accounts: [],
    currentIndex: null,
    lastSuccessfulAccount: null,
    updatedAt: new Date().toISOString()
  };
}

export async function loadState(appHome: string): Promise<AppState> {
  const fileContents = await readTextIfExists(statePath(appHome));

  if (!fileContents) {
    return createEmptyState();
  }

  const parsed = appStateSchema.parse(JSON.parse(fileContents));
  if (parsed.accounts.length === 0) {
    return {
      ...parsed,
      currentIndex: null
    };
  }

  if (parsed.currentIndex === null || parsed.currentIndex >= parsed.accounts.length) {
    return {
      ...parsed,
      currentIndex: 0
    };
  }

  return parsed;
}

export async function saveState(appHome: string, state: AppState): Promise<void> {
  const normalized = appStateSchema.parse({
    ...state,
    currentIndex: state.accounts.length === 0 ? null : state.currentIndex ?? 0,
    updatedAt: new Date().toISOString()
  });

  await writeJsonAtomic(statePath(appHome), normalized);
}

export function removeAccountFromState(state: AppState, name: string): AppState {
  const nextAccounts = state.accounts.filter((account) => account !== name);

  if (nextAccounts.length === 0) {
    return {
      ...state,
      accounts: [],
      currentIndex: null,
      lastSuccessfulAccount: state.lastSuccessfulAccount === name ? null : state.lastSuccessfulAccount,
      updatedAt: new Date().toISOString()
    };
  }

  const removedIndex = state.accounts.indexOf(name);
  let nextIndex = state.currentIndex ?? 0;

  if (removedIndex !== -1 && nextIndex > removedIndex) {
    nextIndex -= 1;
  } else if (removedIndex !== -1 && nextIndex === removedIndex) {
    nextIndex = Math.min(removedIndex, nextAccounts.length - 1);
  }

  return {
    ...state,
    accounts: nextAccounts,
    currentIndex: nextIndex,
    lastSuccessfulAccount: state.lastSuccessfulAccount === name ? null : state.lastSuccessfulAccount,
    updatedAt: new Date().toISOString()
  };
}
