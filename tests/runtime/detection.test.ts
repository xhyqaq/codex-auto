import { describe, expect, test, vi } from 'vitest';
import { extractQuotaRetryAvailability, hasQuotaError } from '../../src/lib/detection.js';

describe('quota detection', () => {
  test('detects the observed codex quota exhaustion prompt', () => {
    expect(
      hasQuotaError("■ You've hit your usage limit. To get more access now, send a request to your admin.")
    ).toBe(true);
    expect(
      hasQuotaError(
        "■ You've hit your usage limit. To get more access now, send a request to your admin\nor try again at 11:10 PM."
      )
    ).toBe(true);
  });

  test('does not treat advisory or unrelated prompts as quota exhaustion', () => {
    expect(hasQuotaError('Approaching rate limits')).toBe(false);
    expect(hasQuotaError('Switch to gpt-5.1-codex-mini for lower credit usage?')).toBe(false);
    expect(
      hasQuotaError(
        '■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit /feedback to report the issue.'
      )
    ).toBe(false);
    expect(
      hasQuotaError(
        'Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.'
      )
    ).toBe(false);
    expect(hasQuotaError('network timeout while calling tool')).toBe(false);
  });

  test('extracts the retry time string and a comparable timestamp from quota text', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T08:00:00.000Z'));
    try {
      const result = extractQuotaRetryAvailability(
        "■ You've hit your usage limit. To get more access now, send a request to your admin.\nor try again at 11:10 PM."
      );

      expect(result?.displayText).toBe('11:10 PM');
      expect(result?.availableAt).toMatch(/2026-04-18T/);
    } finally {
      vi.useRealTimers();
    }
  });

  test('rolls retry time to the next day when the same-day time has already passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T15:30:00.000Z'));
    try {
      const result = extractQuotaRetryAvailability(
        "■ You've hit your usage limit. To get more access now, send a request to your admin.\nor try again at 11:10 PM."
      );

      expect(result?.displayText).toBe('11:10 PM');
      expect(result?.availableAt).toMatch(/2026-04-19T/);
    } finally {
      vi.useRealTimers();
    }
  });
});
