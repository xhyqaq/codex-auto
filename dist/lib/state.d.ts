import { z } from 'zod';
declare const appStateSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    accounts: z.ZodArray<z.ZodString>;
    currentIndex: z.ZodNullable<z.ZodNumber>;
    lastSuccessfulAccount: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type AppState = z.infer<typeof appStateSchema>;
export declare function createEmptyState(): AppState;
export declare function loadState(appHome: string): Promise<AppState>;
export declare function saveState(appHome: string, state: AppState): Promise<void>;
export declare function removeAccountFromState(state: AppState, name: string): AppState;
export {};
