import { type AppState } from './state.js';
export type LoginRunner = (accountHome: string) => Promise<void>;
export type AddAccountOptions = {
    runLogin?: LoginRunner;
    configPath?: string;
    authPath?: string;
};
export declare function addAccount(appHome: string, name: string, options?: LoginRunner | AddAccountOptions): Promise<void>;
export declare function removeAccount(appHome: string, name: string): Promise<void>;
export declare function renderAccountList(state: AppState): string;
export declare function markAccountUsed(appHome: string, name: string): Promise<void>;
