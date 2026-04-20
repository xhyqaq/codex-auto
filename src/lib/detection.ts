import stripAnsi from 'strip-ansi';
import type { RetryAvailability } from './state.js';

const quotaPatterns = [
  /you(?:'|’)ve hit your usage limit\.\s+to get more access now,\s+send a request to your admin\.?(?:\s+or try again at [^\n]+\.?)?/i
];
const retryAtPattern = /or try again at ([^\n.]+)\.?/i;

const promptPattern = /(^|\n)(?:›|>)(?:\s|$)/g;

function parseMeridiemTime(displayText: string): Date | null {
  const match = displayText.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) {
    return null;
  }

  const [, rawHours, rawMinutes, period] = match;
  const hours = Number.parseInt(rawHours, 10);
  const minutes = Number.parseInt(rawMinutes, 10);
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
    return null;
  }

  const now = new Date();
  const candidate = new Date(now);
  let normalizedHours = hours % 12;
  if (period.toUpperCase() === 'PM') {
    normalizedHours += 12;
  }

  candidate.setHours(normalizedHours, minutes, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

export function sanitizeTerminalOutput(output: string): string {
  return stripAnsi(output)
    .replace(/\r/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\u0000/g, '');
}

export function getOutputSinceLatestPrompt(output: string): string | null {
  const normalized = sanitizeTerminalOutput(output);
  promptPattern.lastIndex = 0;

  let lastMatch: RegExpExecArray | null = null;
  let nextMatch: RegExpExecArray | null;
  while ((nextMatch = promptPattern.exec(normalized)) !== null) {
    lastMatch = nextMatch;
  }

  if (!lastMatch) {
    return null;
  }

  return normalized.slice(lastMatch.index + lastMatch[0].length);
}

export function hasPromptMarker(output: string): boolean {
  return getOutputSinceLatestPrompt(output) !== null;
}

export function hasQuotaError(output: string): boolean {
  const normalized = sanitizeTerminalOutput(output);
  return quotaPatterns.some((pattern) => pattern.test(normalized));
}

export function extractQuotaRetryAvailability(output: string): RetryAvailability | null {
  const normalized = sanitizeTerminalOutput(output);
  const match = normalized.match(retryAtPattern);
  const displayText = match?.[1]?.trim();
  if (!displayText) {
    return null;
  }

  const availableAt = parseMeridiemTime(displayText);
  if (!availableAt) {
    return null;
  }

  return {
    displayText,
    availableAt: availableAt.toISOString()
  };
}
