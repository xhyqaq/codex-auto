import stripAnsi from 'strip-ansi';

const quotaPatterns = [
  /\busage limit exceeded\b/i,
  /\busagelimitexceeded\b/i,
  /\byou(?:'|’)ve hit your usage limit\b/i,
  /\brate limit(?: reached| exceeded)?\b/i,
  /\bquota exceeded\b/i,
  /\blimit reached\b/i,
  /额度.*耗尽/,
  /没有额度/,
  /超出.*限额/
];

export function sanitizeTerminalOutput(output: string): string {
  return stripAnsi(output)
    .replace(/\r/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\u0000/g, '');
}

export function hasQuotaError(output: string): boolean {
  const normalized = sanitizeTerminalOutput(output);
  return quotaPatterns.some((pattern) => pattern.test(normalized));
}
