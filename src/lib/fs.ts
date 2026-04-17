import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  return readFile(filePath, 'utf8');
}

export async function writeTextAtomic(filePath: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, contents, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, filePath);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, JSON.stringify(value, null, 2));
}

export async function copyFileAtomic(sourcePath: string, destinationPath: string): Promise<void> {
  await ensureDir(path.dirname(destinationPath));
  const tempPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
  await copyFile(sourcePath, tempPath);
  await rename(tempPath, destinationPath);
}

export async function removePathIfExists(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
}
