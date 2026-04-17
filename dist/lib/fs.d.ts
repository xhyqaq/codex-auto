export declare function ensureDir(dirPath: string): Promise<void>;
export declare function pathExists(targetPath: string): Promise<boolean>;
export declare function readTextIfExists(filePath: string): Promise<string | null>;
export declare function writeTextAtomic(filePath: string, contents: string): Promise<void>;
export declare function writeJsonAtomic(filePath: string, value: unknown): Promise<void>;
export declare function copyFileAtomic(sourcePath: string, destinationPath: string): Promise<void>;
export declare function removePathIfExists(targetPath: string): Promise<void>;
