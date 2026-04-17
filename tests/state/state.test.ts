import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createTempAppHome, cleanupTempDir } from '../helpers/temp.js';
import { loadState, removeAccountFromState, saveState } from '../../src/lib/state.js';

describe('state management', () => {
  test('creates empty state when the file is missing', async () => {
    const appHome = await createTempAppHome();
    try {
      const state = await loadState(appHome);
      expect(state.accounts).toEqual([]);
      expect(state.currentIndex).toBeNull();
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('removes the last account cleanly', async () => {
    const appHome = await createTempAppHome();
    try {
      await saveState(appHome, {
        version: 1,
        accounts: ['solo'],
        currentIndex: 0,
        lastSuccessfulAccount: 'solo',
        updatedAt: '2026-04-17T00:00:00.000Z'
      });

      const next = removeAccountFromState(await loadState(appHome), 'solo');
      expect(next.accounts).toEqual([]);
      expect(next.currentIndex).toBeNull();
    } finally {
      await cleanupTempDir(appHome);
    }
  });
});
