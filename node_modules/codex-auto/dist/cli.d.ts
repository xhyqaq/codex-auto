import type { Writable } from 'node:stream';
type OutputLike = Writable & {
    columns?: number;
    rows?: number;
    isTTY?: boolean;
};
export type CliRunOptions = {
    appHome?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: NodeJS.ReadStream;
    stdout?: OutputLike;
    stderr?: OutputLike;
    interactive?: boolean;
};
export declare function runCli(argv: string[], options?: CliRunOptions): Promise<number>;
export {};
