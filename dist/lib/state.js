import { z } from 'zod';
import { readTextIfExists, writeJsonAtomic } from './fs.js';
import { statePath } from './paths.js';
const appStateSchema = z.object({
    version: z.literal(1),
    accounts: z.array(z.string()),
    currentIndex: z.number().int().nonnegative().nullable(),
    lastSuccessfulAccount: z.string().nullable(),
    lastSessionId: z.string().nullable().default(null),
    updatedAt: z.string()
});
export function createEmptyState() {
    return {
        version: 1,
        accounts: [],
        currentIndex: null,
        lastSuccessfulAccount: null,
        lastSessionId: null,
        updatedAt: new Date().toISOString()
    };
}
export async function loadState(appHome) {
    const fileContents = await readTextIfExists(statePath(appHome));
    if (!fileContents) {
        return createEmptyState();
    }
    const parsed = appStateSchema.parse(JSON.parse(fileContents));
    const normalized = parsed;
    if (normalized.accounts.length === 0) {
        return {
            ...normalized,
            currentIndex: null
        };
    }
    if (normalized.currentIndex === null || normalized.currentIndex >= normalized.accounts.length) {
        return {
            ...normalized,
            currentIndex: 0
        };
    }
    return normalized;
}
export async function saveState(appHome, state) {
    const normalized = appStateSchema.parse({
        ...state,
        currentIndex: state.accounts.length === 0 ? null : state.currentIndex ?? 0,
        lastSessionId: state.lastSessionId ?? null,
        updatedAt: new Date().toISOString()
    });
    await writeJsonAtomic(statePath(appHome), normalized);
}
export function removeAccountFromState(state, name) {
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
    }
    else if (removedIndex !== -1 && nextIndex === removedIndex) {
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
