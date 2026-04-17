import stripAnsi from 'strip-ansi';
const quotaPatterns = [
    /you(?:'|’)ve hit your usage limit\.\s+to get more access now,\s+send a request to your admin\.?(?:\s+or try again at [^\n]+\.?)?/i
];
const promptPattern = /(^|\n)(?:›|>)(?:\s|$)/g;
export function sanitizeTerminalOutput(output) {
    return stripAnsi(output)
        .replace(/\r/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\u0000/g, '');
}
export function hasPromptMarker(output) {
    promptPattern.lastIndex = 0;
    return promptPattern.test(sanitizeTerminalOutput(output));
}
export function hasQuotaError(output) {
    const normalized = sanitizeTerminalOutput(output);
    return quotaPatterns.some((pattern) => pattern.test(normalized));
}
