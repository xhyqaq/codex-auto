import { describe, expect, test } from 'vitest';
import { hasQuotaError } from '../../src/lib/detection.js';

describe('quota detection', () => {
  test('detects explicit quota errors from sanitized output', () => {
    expect(hasQuotaError('Error: usage limit exceeded for this account')).toBe(true);
    expect(hasQuotaError('network timeout while calling tool')).toBe(false);
  });
});
