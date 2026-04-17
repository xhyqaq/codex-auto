import type { Writable } from 'node:stream';
type OutputLike = Writable & {
    columns?: number;
    rows?: number;
    isTTY?: boolean;
};
export type RunManagedSessionOptions = {
    appHome: string;
    workspaceDir: string;
    preferredAccountName?: string;
    codexCommand?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: NodeJS.ReadStream;
    stdout?: OutputLike;
    stderr?: OutputLike;
    interactive?: boolean;
};
export type RunManagedSessionResult = {
    finalAccount: string;
    switchCount: number;
    exitCode: number;
    exhaustedAll: boolean;
};
export declare function runManagedSession(options: RunManagedSessionOptions): Promise<RunManagedSessionResult>;
export {};
