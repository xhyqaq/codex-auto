import { describe, expect, test } from 'vitest';
import { pickNextAccount } from '../../src/lib/rotation.js';

describe('rotation', () => {
  test('selects the next non-exhausted account in order', () => {
    const next = pickNextAccount(['a', 'b', 'c'], 0, new Set(['a', 'b']));
    expect(next).toEqual({ name: 'c', index: 2 });
  });
});
