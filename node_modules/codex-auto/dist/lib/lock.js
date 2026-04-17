import { open, readFile, rm } from 'node:fs/promises';
import { ensureDir } from './fs.js';
import { runtimeHome, runtimeLockPath } from './paths.js';
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
async function writeNewLock(lockPath) {
    const handle = await open(lockPath, 'wx', 0o600);
    try {
        const payload = {
            pid: process.pid,
            createdAt: new Date().toISOString()
        };
        await handle.writeFile(JSON.stringify(payload, null, 2), 'utf8');
    }
    finally {
        await handle.close();
    }
}
export async function acquireRuntimeLock(appHome) {
    await ensureDir(runtimeHome(appHome));
    const lockPath = runtimeLockPath(appHome);
    try {
        await writeNewLock(lockPath);
    }
    catch (error) {
        const maybeNodeError = error;
        if (maybeNodeError.code !== 'EEXIST') {
            throw error;
        }
        const existingPayload = JSON.parse(await readFile(lockPath, 'utf8'));
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
