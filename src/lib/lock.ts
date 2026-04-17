import { open, readFile, rm } from 'node:fs/promises';
import { ensureDir } from './fs.js';
import { runtimeHome, runtimeLockPath } from './paths.js';

type LockPayload = {
  pid: number;
  createdAt: string;
};

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function writeNewLock(lockPath: string): Promise<void> {
  const handle = await open(lockPath, 'wx', 0o600);
  try {
    const payload: LockPayload = {
      pid: process.pid,
      createdAt: new Date().toISOString()
    };
    await handle.writeFile(JSON.stringify(payload, null, 2), 'utf8');
  } finally {
    await handle.close();
  }
}

export async function acquireRuntimeLock(appHome: string): Promise<() => Promise<void>> {
  await ensureDir(runtimeHome(appHome));
  const lockPath = runtimeLockPath(appHome);

  try {
    await writeNewLock(lockPath);
  } catch (error) {
    const maybeNodeError = error as NodeJS.ErrnoException;
    if (maybeNodeError.code !== 'EEXIST') {
      throw error;
    }

    const existingPayload = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<LockPayload>;
    if (typeof existingPayload.pid === 'number' && isProcessRunning(existingPayload.pid)) {
      throw new Error('codex-auto is already running for this runtime');
    }

    await rm(lockPath, { force: true });
    await writeNewLock(lockPath);
  }

  return async () => {
    await rm(lockPath, { force: true });
  };
}
