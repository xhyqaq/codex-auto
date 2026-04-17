export declare function resolveCodexCommand(env?: NodeJS.ProcessEnv): string;
export declare function buildCodexShellCommand(codexCommand: string, args: string[]): string;
export declare function runCodexLogin(options: {
    accountHome: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    codexCommand?: string;
}): Promise<void>;
