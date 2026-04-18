import { z } from 'zod';
import { readTextIfExists, writeJsonAtomic } from './fs.js';
import { statePath } from './paths.js';

const appStateSchema = z.object({
  version: z.literal(1),
  accounts: z.array(z.string()),
  currentIndex: z.number().int().nonnegative().nullable(),
  preferredAccountName: z.string().nullable().default(null),
  lastSuccessfulAccount: z.string().nullable(),
  lastSessionId: z.string().nullable().default(null),
  updatedAt: z.string()
});

export type AppState = z.infer<typeof appStateSchema>;

export function createEmptyState(): AppState {
  return {
    version: 1,
    accounts: [],
    currentIndex: null,
    preferredAccountName: null,
    lastSuccessfulAccount: null,
    lastSessionId: null,
    updatedAt: new Date().toISOString()
  };
}

export async function loadState(appHome: string): Promise<AppState> {
  const fileContents = await readTextIfExists(statePath(appHome));

  if (!fileContents) {
    return createEmptyState();
  }

  const parsed = appStateSchema.parse(JSON.parse(fileContents));
  const normalized = parsed;
  if (normalized.accounts.length === 0) {
    return {
      ...normalized,
      currentIndex: null,
      preferredAccountName: null
    };
  }

  const currentIndex =
    normalized.currentIndex === null || normalized.currentIndex >= normalized.accounts.length ? 0 : normalized.currentIndex;
  const preferredAccountName =
    normalized.preferredAccountName === null
      ? null
      : normalized.accounts.includes(normalized.preferredAccountName)
        ? normalized.preferredAccountName
        : normalized.accounts[0] ?? null;

  return {
    ...normalized,
    currentIndex,
    preferredAccountName
  };
}

export async function saveState(appHome: string, state: AppState): Promise<void> {
  const normalized = appStateSchema.parse({
    ...state,
    currentIndex: state.accounts.length === 0 ? null : state.currentIndex ?? 0,
    preferredAccountName:
      state.accounts.length === 0
        ? null
        : state.preferredAccountName === null
          ? null
          : state.accounts.includes(state.preferredAccountName)
            ? state.preferredAccountName
            : state.accounts[0] ?? null,
    lastSessionId: state.lastSessionId ?? null,
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
      preferredAccountName: null,
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
    preferredAccountName:
      state.preferredAccountName === name
        ? nextAccounts[0] ?? null
        : state.preferredAccountName && nextAccounts.includes(state.preferredAccountName)
          ? state.preferredAccountName
          : nextAccounts[0] ?? null,
    lastSuccessfulAccount: state.lastSuccessfulAccount === name ? null : state.lastSuccessfulAccount,
    updatedAt: new Date().toISOString()
  };
}
