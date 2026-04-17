import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from './fs.js';
import { logsRoot } from './paths.js';

export type SessionLogger = {
  path: string;
  log: (event: string, details?: Record<string, unknown>) => Promise<void>;
};

export async function createSessionLogger(appHome: string): Promise<SessionLogger> {
  const logDirectory = logsRoot(appHome);
  await ensureDir(logDirectory);
  const filePath = path.join(logDirectory, `session-${Date.now()}.log`);

  return {
    path: filePath,
    async log(event, details = {}) {
      await appendFile(
        filePath,
        `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`,
        'utf8'
      );
    }
  };
}
