export type SessionLogger = {
    path: string;
    log: (event: string, details?: Record<string, unknown>) => Promise<void>;
};
export declare function createSessionLogger(appHome: string): Promise<SessionLogger>;
