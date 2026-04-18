import { describe, expect, test, vi } from 'vitest';
import { createTempAppHome, cleanupTempDir } from '../helpers/temp.js';
import { loadState, removeAccountFromState, saveState } from '../../src/lib/state.js';

describe('state management', () => {
  test('creates empty state when the file is missing', async () => {
    const appHome = await createTempAppHome();
    try {
      const state = await loadState(appHome);
      expect(state.accounts).toEqual([]);
      expect(state.currentIndex).toBeNull();
      expect(state.retryAvailabilityByAccount).toEqual({});
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
        preferredAccountName: 'solo',
        lastSuccessfulAccount: 'solo',
        lastSessionId: null,
        retryAvailabilityByAccount: {
          solo: {
            displayText: '11:10 PM',
            availableAt: '2026-04-18T23:10:00.000Z'
          }
        },
        updatedAt: '2026-04-17T00:00:00.000Z'
      });

      const next = removeAccountFromState(await loadState(appHome), 'solo');
      expect(next.accounts).toEqual([]);
      expect(next.currentIndex).toBeNull();
      expect(next.retryAvailabilityByAccount).toEqual({});
    } finally {
      await cleanupTempDir(appHome);
    }
  });

  test('loadState clears expired retry availability entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T23:30:00.000Z'));
    const appHome = await createTempAppHome();
    try {
      await saveState(appHome, {
        version: 1,
        accounts: ['a'],
        currentIndex: 0,
        preferredAccountName: 'a',
        lastSuccessfulAccount: null,
        lastSessionId: null,
        retryAvailabilityByAccount: {
          a: {
            displayText: '11:10 PM',
            availableAt: '2026-04-18T23:10:00.000Z'
          }
        },
        updatedAt: '2026-04-18T00:00:00.000Z'
      });

      await expect(loadState(appHome)).resolves.toMatchObject({
        retryAvailabilityByAccount: {}
      });
    } finally {
      vi.useRealTimers();
      await cleanupTempDir(appHome);
    }
  });
});
