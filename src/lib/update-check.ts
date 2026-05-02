import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { readTextIfExists, writeJsonAtomic } from './fs.js';
import { updateCheckPath } from './paths.js';

const updateCacheTtlMs = 24 * 60 * 60 * 1000;
const registryTimeoutMs = 2500;

const updateCheckCacheSchema = z.object({
  checkedAt: z.string(),
  latestVersion: z.string().nullable().default(null),
  skippedVersion: z.string().nullable().default(null)
});

type UpdateCheckCache = z.infer<typeof updateCheckCacheSchema>;

type OutputLike = Writable & {
  isTTY?: boolean;
};

export type UpdateCheckOptions = {
  appHome: string;
  packageName: string;
  currentVersion: string;
  stdin: Readable & { isTTY?: boolean };
  stderr: OutputLike;
  env?: NodeJS.ProcessEnv;
  force?: boolean;
  now?: Date;
  fetchLatestVersion?: (packageName: string) => Promise<string | null>;
  readAnswer?: () => Promise<string>;
  runInstall?: (packageName: string) => Promise<number>;
};

async function readCache(appHome: string): Promise<UpdateCheckCache | null> {
  const text = await readTextIfExists(updateCheckPath(appHome));
  if (!text) {
    return null;
  }

  try {
    return updateCheckCacheSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

async function writeCache(appHome: string, cache: UpdateCheckCache): Promise<void> {
  await writeJsonAtomic(updateCheckPath(appHome), cache);
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.replace(/^v/, '').split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.replace(/^v/, '').split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let i = 0; i < length; i += 1) {
    const leftPart = leftParts[i] ?? 0;
    const rightPart = rightParts[i] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function shouldSkipForEnv(env: NodeJS.ProcessEnv): boolean {
  return env.CODEX_AUTO_UPDATE_CHECK === '0' || env.CODEX_AUTO_NO_UPDATE_CHECK === '1';
}

function isFresh(cache: UpdateCheckCache | null, now: Date): boolean {
  if (!cache) {
    return false;
  }

  const checkedAtMs = Date.parse(cache.checkedAt);
  return Number.isFinite(checkedAtMs) && now.getTime() - checkedAtMs < updateCacheTtlMs;
}

async function fetchLatestVersionFromNpm(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), registryTimeoutMs);

  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      signal: controller.signal,
      headers: {
        accept: 'application/json'
      }
    });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function promptForAnswer(stdin: Readable, stderr: OutputLike): Promise<string> {
  const readline = createInterface({
    input: stdin,
    output: stderr,
    terminal: Boolean(stderr.isTTY)
  });

  try {
    return await readline.question('[codex-auto] Update now? y = update, s = skip this version, Enter = later: ');
  } finally {
    readline.close();
  }
}

async function installLatest(packageName: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', `${packageName}@latest`], {
      stdio: 'inherit'
    });

    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function maybePromptForUpdate(options: UpdateCheckOptions): Promise<void> {
  const env = options.env ?? process.env;
  if (!options.force && shouldSkipForEnv(env)) {
    return;
  }

  const interactive = Boolean(options.stdin.isTTY && options.stderr.isTTY);
  if (!options.force && !interactive) {
    return;
  }

  const now = options.now ?? new Date();
  const cache = await readCache(options.appHome);
  let latestVersion = isFresh(cache, now) ? cache?.latestVersion ?? null : null;

  if (!latestVersion) {
    latestVersion = await (options.fetchLatestVersion ?? fetchLatestVersionFromNpm)(options.packageName);
    await writeCache(options.appHome, {
      checkedAt: now.toISOString(),
      latestVersion,
      skippedVersion: cache?.skippedVersion ?? null
    });
  }

  if (!latestVersion || compareVersions(latestVersion, options.currentVersion) <= 0) {
    return;
  }

  if (cache?.skippedVersion === latestVersion) {
    return;
  }

  options.stderr.write(
    `\n[codex-auto] Update available: ${options.packageName} ${options.currentVersion} -> ${latestVersion}\n` +
      `[codex-auto] Update command: npm install -g ${options.packageName}@latest\n`
  );

  const answer = (await (options.readAnswer ?? (() => promptForAnswer(options.stdin, options.stderr)))()).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    options.stderr.write(`[codex-auto] Running npm install -g ${options.packageName}@latest\n`);
    const exitCode = await (options.runInstall ?? installLatest)(options.packageName);
    if (exitCode === 0) {
      options.stderr.write('[codex-auto] Update finished. Restart codex-auto to use the new version.\n');
    } else {
      options.stderr.write('[codex-auto] Update failed. You can run the update command manually.\n');
    }
    return;
  }

  if (answer === 's' || answer === 'skip') {
    await writeCache(options.appHome, {
      checkedAt: now.toISOString(),
      latestVersion,
      skippedVersion: latestVersion
    });
    options.stderr.write(`[codex-auto] Skipping update ${latestVersion}.\n`);
    return;
  }

  await writeCache(options.appHome, {
    checkedAt: now.toISOString(),
    latestVersion,
    skippedVersion: cache?.skippedVersion ?? null
  });
}
