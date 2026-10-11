import { describe, expect, test, vi } from 'vitest';
import { extractQuotaRetryAvailability, hasQuotaError, removeHistoricalQuotaMessages } from '../../src/lib/detection.js';

function formatMeridiemTime(date: Date): string {
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const period = hours24 >= 12 ? 'PM' : 'AM';
  return `${hours12}:${minutes} ${period}`;
}

describe('quota detection', () => {
  test('anchors a recorded bare reset time to its event date instead of tomorrow', () => {
    const recorded = new Date(2026, 3, 18, 10, 59);
    const expected = new Date(2026, 3, 18, 11, 0);
    expect(extractQuotaRetryAvailability("You've hit your usage limit. Upgrade to Pro or try again at 11:00 AM.", recorded)?.availableAt).toBe(expected.toISOString());
  });

  test('removes exact historical text across wrapping and apostrophe variants, but preserves fresh quota', () => {
    const old = "You’ve hit your usage limit. Upgrade to Pro or try again at 11:00 AM.";
    const replay = "› old prompt\n■ You've hit your usage limit.\nUpgrade to Pr\no or try again at 11:00 AM.";
    expect(hasQuotaError(removeHistoricalQuotaMessages(replay, [old]))).toBe(false);
    expect(hasQuotaError(removeHistoricalQuotaMessages(replay + "\n› live prompt\nYou've hit your usage limit. Upgrade to Pro or try again at 3:00 PM.", [old]))).toBe(true);
    expect(removeHistoricalQuotaMessages(replay, [old])).not.toContain("hit your usage limit");
    expect(hasQuotaError(removeHistoricalQuotaMessages(replay.replace("Pr\no", "Pro"), []))).toBe(true);
  });

  test('detects the observed codex quota exhaustion prompt', () => {
    expect(
      hasQuotaError("■ You've hit your usage limit. To get more access now, send a request to your admin.")
    ).toBe(true);
    expect(
      hasQuotaError(
        "■ You've hit your usage limit. To get more access now, send a request to your admin\nor try again at 11:10 PM."
      )
    ).toBe(true);
    expect(
      hasQuotaError(
        "■ You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 6:42 PM."
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
    const now = new Date('2026-04-18T08:00:00.000Z');
    vi.setSystemTime(now);
    try {
      const nextRetry = new Date(now);
      nextRetry.setHours(now.getHours() + 1, 10, 0, 0);
      const displayText = formatMeridiemTime(nextRetry);
      const result = extractQuotaRetryAvailability(
        `■ You've hit your usage limit. To get more access now, send a request to your admin.\nor try again at ${displayText}.`
      );

      expect(result?.displayText).toBe(displayText);
      expect(result?.availableAt).toBe(nextRetry.toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  test('rolls retry time to the next day when the same-day time has already passed', () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-18T15:30:00.000Z');
    vi.setSystemTime(now);
    try {
      const previousRetry = new Date(now);
      previousRetry.setHours(now.getHours() - 1, 10, 0, 0);
      const displayText = formatMeridiemTime(previousRetry);
      const expectedAvailableAt = new Date(now);
      expectedAvailableAt.setHours(previousRetry.getHours(), previousRetry.getMinutes(), 0, 0);
      if (expectedAvailableAt.getTime() <= now.getTime()) {
        expectedAvailableAt.setDate(expectedAvailableAt.getDate() + 1);
      }
      const result = extractQuotaRetryAvailability(
        `■ You've hit your usage limit. To get more access now, send a request to your admin.\nor try again at ${displayText}.`
      );

      expect(result?.displayText).toBe(displayText);
      expect(result?.availableAt).toBe(expectedAvailableAt.toISOString());
    } finally {
      vi.useRealTimers();
    }
  });
});
