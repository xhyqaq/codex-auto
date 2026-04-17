export type TomlObject = Record<string, unknown>;
export declare function mergeTomlObjects(base: TomlObject, override: TomlObject): TomlObject;
export declare function renderToml(document: TomlObject): string;
export declare function ensureAccountConfig(appHome: string, accountName: string): Promise<TomlObject>;
export declare function buildRuntimeConfig(appHome: string, accountName: string): Promise<string>;
