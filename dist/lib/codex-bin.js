import { spawn } from 'node:child_process';
export function resolveCodexCommand(env = process.env) {
    return env.CODEX_AUTO_CODEX_BIN?.trim() || 'codex';
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
export function buildCodexShellCommand(codexCommand, args) {
    const renderedArgs = args.map(shellQuote).join(' ');
    return renderedArgs ? `${codexCommand} ${renderedArgs}` : codexCommand;
}
export async function runCodexLogin(options) {
    const env = {
        ...process.env,
        ...options.env,
        CODEX_HOME: options.accountHome
    };
    const codexCommand = options.codexCommand ?? resolveCodexCommand(env);
    const shell = env.SHELL || '/bin/zsh';
    const command = buildCodexShellCommand(codexCommand, ['login']);
    await new Promise((resolve, reject) => {
        const child = spawn(shell, ['-lc', command], {
            cwd: options.cwd,
            env,
            stdio: 'inherit'
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`codex login exited with code ${code ?? 'unknown'}`));
            }
        });
    });
}
