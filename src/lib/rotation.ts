import type { AppState } from './state.js';

export type AccountSelection = {
  name: string;
  index: number;
};

export function getCurrentAccount(state: AppState): AccountSelection | null {
  if (state.accounts.length === 0) {
    return null;
  }

  const index = state.currentIndex ?? 0;
  return {
    name: state.accounts[index] ?? state.accounts[0],
    index: state.accounts[index] ? index : 0
  };
}

export function getAccountByName(state: AppState, accountName: string): AccountSelection | null {
  const index = state.accounts.indexOf(accountName);
  if (index === -1) {
    return null;
  }

  return {
    name: state.accounts[index],
    index
  };
}

export function pickNextAccount(
  accounts: string[],
  currentIndex: number,
  exhausted: Set<string>
): AccountSelection | null {
  if (accounts.length === 0) {
    return null;
  }

  for (let offset = 1; offset <= accounts.length; offset += 1) {
    const nextIndex = (currentIndex + offset) % accounts.length;
    const nextAccount = accounts[nextIndex];
    if (!exhausted.has(nextAccount)) {
      return {
        name: nextAccount,
        index: nextIndex
      };
    }
  }

  return null;
}
