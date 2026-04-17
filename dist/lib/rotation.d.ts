import type { AppState } from './state.js';
export type AccountSelection = {
    name: string;
    index: number;
};
export declare function getCurrentAccount(state: AppState): AccountSelection | null;
export declare function getAccountByName(state: AppState, accountName: string): AccountSelection | null;
export declare function pickNextAccount(accounts: string[], currentIndex: number, exhausted: Set<string>): AccountSelection | null;
