import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { spawn as spawnPty } from 'node-pty';
import path from 'node:path';
import { createSessionLogger } from './logger.js';
import { buildCodexShellCommand, resolveCodexCommand } from './codex-bin.js';
import { extractQuotaRetryAvailability, hasPromptMarker, hasQuotaError, sanitizeTerminalOutput } from './detection.js';
import { markAccountUsed } from './accounts.js';
import { readTextIfExists } from './fs.js';
import { accountAuthPath, instanceHome, resolveCodexHome } from './paths.js';
import { getAccountByName, getCurrentAccount, getPreferredAccount, pickNextAccount } from './rotation.js';
import { writeManagedRunState } from './run-state.js';
import { ensureAppLayout, cleanupInstanceOverlay, createInstanceOverlay, replaceOverlayAuth } from './runtime.js';
import { loadState, saveState, type RetryAvailability } from './state.js';

type OutputLike = Writable & {
  columns?: number;
  rows?: number;
  isTTY?: boolean;
};

export type RunManagedSessionOptions = {
  appHome: string;
  codexHome?: string;
  workspaceDir: string;
  preferredAccountName?: string;
  extraArgs?: string[];
  codexCommand?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: NodeJS.ReadStream;
  stdout?: OutputLike;
  stderr?: OutputLike;
  interactive?: boolean;
};

const nonInteractiveSubcommands = new Set([
  'exec', 'e', 'review', 'login', 'logout', 'mcp', 'marketplace',
  'mcp-server', 'app-server', 'app', 'completion', 'sandbox', 'debug',
  'apply', 'a', 'cloud', 'exec-server', 'features', 'help'
]);

function buildFirstRunArgs(extraArgs: string[]): string[] {
  const args = [...extraArgs];
  if (!args.includes('--no-alt-screen')) {
    const firstPositional = args.find((a) => !a.startsWith('-'));
    if (!firstPositional || !nonInteractiveSubcommands.has(firstPositional)) {
      args.push('--no-alt-screen');
    }
  }
  return args;
}

export type RunManagedSessionResult = {
  finalAccount: string;
  switchCount: number;
  exitCode: number;
  exhaustedAll: boolean;
};

type InvocationResult = {
  exitCode: number;
  quotaError: boolean;
  output: string;
  retryAvailability: RetryAvailability | null;
};

function canUseInteractiveTerminal(
  stdin: NodeJS.ReadStream,
  stdout: OutputLike,
  stderr: OutputLike
): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY && stderr.isTTY);
}

function toPtyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function getTerminalSize(stdout: OutputLike): { cols: number; rows: number } {
  return {
    cols: Math.max(1, stdout.columns ?? 80),
    rows: Math.max(1, stdout.rows ?? 24)
  };
}

function enterRawMode(stdin: NodeJS.ReadStream): (() => void) | null {
  const ttyStdin = stdin as NodeJS.ReadStream & {
    setRawMode?: (value: boolean) => void;
    isRaw?: boolean;
    resume?: () => void;
    pause?: () => void;
  };

  if (!ttyStdin.isTTY || typeof ttyStdin.setRawMode !== 'function') {
    return null;
  }

  const previousRawMode = ttyStdin.isRaw === true;
  ttyStdin.setRawMode(true);
  ttyStdin.resume?.();

  return () => {
    ttyStdin.setRawMode?.(previousRawMode);
    ttyStdin.pause?.();
  };
}

function hasMissingSessionError(output: string): boolean {
  return /No saved session found with ID/i.test(output);
}

type SessionCandidate = {
  id: string;
  cwd: string | null;
  timestampMs: number;
};

function parseDateMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readSessionCandidatesFromFiles(instanceDir: string): Promise<SessionCandidate[]> {
  const sessionFiles = await collectSessionFiles(path.join(instanceDir, 'sessions'));
  const candidates: SessionCandidate[] = [];

  for (const sessionFile of sessionFiles) {
    const fileText = await readTextIfExists(sessionFile);
    const firstLine = fileText?.split('\n').find((line) => line.trim().length > 0);
    if (!firstLine) {
      continue;
    }

    try {
      const parsed = JSON.parse(firstLine) as {
        type?: unknown;
        payload?: { id?: unknown; cwd?: unknown; timestamp?: unknown };
      };

      if (parsed.type !== 'session_meta') {
        continue;
      }

      const timestampMs = parseDateMs(parsed.payload?.timestamp);
      if (typeof parsed.payload?.id === 'string' && timestampMs !== null) {
        candidates.push({
          id: parsed.payload.id,
          cwd: typeof parsed.payload.cwd === 'string' ? parsed.payload.cwd : null,
          timestampMs
        });
      }
    } catch {
      const match = path.basename(sessionFile).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
      if (match) {
        candidates.push({
          id: match[1],
          cwd: null,
          timestampMs: 0
        });
      }
    }
  }

  return candidates;
}

async function readSessionCandidatesFromIndex(instanceDir: string): Promise<SessionCandidate[]> {
  const indexText = await readTextIfExists(path.join(instanceDir, 'session_index.jsonl'));
  if (!indexText) {
    return [];
  }

  const candidates: SessionCandidate[] = [];
  for (const line of indexText.split('\n').map((value) => value.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as { id?: unknown; updated_at?: unknown };
      const timestampMs = parseDateMs(parsed.updated_at);
      if (typeof parsed.id === 'string' && timestampMs !== null) {
        candidates.push({
          id: parsed.id,
          cwd: null,
          timestampMs
        });
      }
    } catch {
      continue;
    }
  }

  return candidates;
}

async function snapshotKnownSessionIds(instanceDir: string): Promise<Set<string>> {
  const [fromFiles, fromIndex] = await Promise.all([
    readSessionCandidatesFromFiles(instanceDir),
    readSessionCandidatesFromIndex(instanceDir)
  ]);

  return new Set([...fromFiles, ...fromIndex].map((candidate) => candidate.id));
}

function selectBestSessionCandidate(
  candidates: SessionCandidate[],
  workspaceDir: string,
  launchStartedAt: number
): string | null {
  const freshCandidates = candidates.filter((candidate) => candidate.timestampMs >= launchStartedAt - 60_000);
  const cwdMatched = freshCandidates.filter((candidate) => candidate.cwd === null || candidate.cwd === workspaceDir);
  const ranked = (cwdMatched.length > 0 ? cwdMatched : freshCandidates).sort((left, right) => {
    const deltaDiff = Math.abs(left.timestampMs - launchStartedAt) - Math.abs(right.timestampMs - launchStartedAt);
    if (deltaDiff !== 0) {
      return deltaDiff;
    }

    return left.timestampMs - right.timestampMs;
  });

  return ranked[0]?.id ?? null;
}

async function discoverSessionId(options: {
  instanceDir: string;
  workspaceDir: string;
  launchStartedAt: number;
  knownSessionIds: Set<string>;
}): Promise<string | null> {
  const [fromFiles, fromIndex] = await Promise.all([
    readSessionCandidatesFromFiles(options.instanceDir),
    readSessionCandidatesFromIndex(options.instanceDir)
  ]);

  const newFileCandidates = fromFiles.filter((candidate) => !options.knownSessionIds.has(candidate.id));
  const discoveredFromFiles = selectBestSessionCandidate(newFileCandidates, options.workspaceDir, options.launchStartedAt);
  if (discoveredFromFiles) {
    return discoveredFromFiles;
  }

  const newIndexCandidates = fromIndex.filter((candidate) => !options.knownSessionIds.has(candidate.id));
  return selectBestSessionCandidate(newIndexCandidates, options.workspaceDir, options.launchStartedAt);
}

async function collectSessionFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          return collectSessionFiles(entryPath);
        }
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          return [entryPath];
        }
        return [];
      })
    );
    return nested.flat();
  } catch {
    return [];
  }
}

async function persistLastSessionId(appHome: string, sessionId: string | null): Promise<void> {
  if (!sessionId) {
    return;
  }

  const state = await loadState(appHome);
  if (state.lastSessionId === sessionId) {
    return;
  }

  state.lastSessionId = sessionId;
  await saveState(appHome, state);
}

async function launchResumeInvocation(options: {
  appHome: string;
  instanceDir: string;
  workspaceDir: string;
  codexCommand: string;
  env: NodeJS.ProcessEnv;
  stdin: NodeJS.ReadStream;
  stdout: OutputLike;
  interactive: boolean;
  sessionId: string;
}): Promise<InvocationResult> {
  return launchInvocation({
    appHome: options.appHome,
    instanceDir: options.instanceDir,
    workspaceDir: options.workspaceDir,
    codexCommand: options.codexCommand,
    args: ['resume', '--no-alt-screen', options.sessionId, 'Continue'],
    env: options.env,
    stdin: options.stdin,
    stdout: options.stdout,
    interactive: options.interactive
  });
}

async function launchInvocation(options: {
  appHome: string;
  instanceDir: string;
  workspaceDir: string;
  codexCommand: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin: NodeJS.ReadStream;
  stdout: OutputLike;
  interactive: boolean;
}): Promise<InvocationResult> {
  const command = buildCodexShellCommand(options.codexCommand, options.args);
  const shell = options.env.SHELL || '/bin/zsh';
  const stdout = options.stdout;
  const deferQuotaDetectionUntilPrompt = options.args[0] === 'resume';
  let sanitizedOutput = '';
  let quotaDetectionArmed = !deferQuotaDetectionUntilPrompt;
  let quotaDetectionStartIndex = 0;

  const evaluateQuotaOutput = (output: string): boolean => {
    if (!quotaDetectionArmed) {
      if (hasPromptMarker(output)) {
        quotaDetectionArmed = true;
        quotaDetectionStartIndex = output.length;
      }
      return false;
    }

    return hasQuotaError(output.slice(quotaDetectionStartIndex));
  };

  if (options.interactive) {
    if (options.env.CODEX_AUTO_INTERACTIVE_TRANSPORT === 'direct') {
      const child = spawn(shell, ['-lc', command], {
        cwd: options.workspaceDir,
        env: toPtyEnv({
          ...options.env,
          CODEX_HOME: options.instanceDir
        }),
        stdio: 'inherit'
      });

      return new Promise<InvocationResult>((resolve) => {
        child.on('error', (error) => {
          resolve({
            exitCode: 1,
            quotaError: false,
            output: error.message,
            retryAvailability: null
          });
        });

        child.on('close', (code) => {
          resolve({
            exitCode: code ?? 1,
            quotaError: false,
            output: '',
            retryAvailability: null
          });
        });
      });
    }
    const terminalSize = getTerminalSize(stdout);
    const ptyProcess = spawnPty(shell, ['-lc', command], {
      name: options.env.TERM || 'xterm-256color',
      cols: terminalSize.cols,
      rows: terminalSize.rows,
      cwd: options.workspaceDir,
      env: {
        ...toPtyEnv(options.env),
        CODEX_HOME: options.instanceDir
      }
    });
    let quotaDetected = false;

    const stdinDataHandler = (chunk: Buffer | string): void => {
      ptyProcess.write(chunk.toString());
    };
    const stdoutResizeHandler = (): void => {
      const nextSize = getTerminalSize(stdout);
      ptyProcess.resize(nextSize.cols, nextSize.rows);
    };

    options.stdin.on('data', stdinDataHandler);
    stdout.on('resize', stdoutResizeHandler);
    const restoreTerminal = enterRawMode(options.stdin);

    const dataDisposable = ptyProcess.onData((data) => {
      stdout.write(data);
      sanitizedOutput = `${sanitizedOutput}${sanitizeTerminalOutput(data)}`.slice(-20000);
      if (quotaDetected || !evaluateQuotaOutput(sanitizedOutput)) {
        return;
      }

      quotaDetected = true;
      ptyProcess.kill();
    });

    return new Promise<InvocationResult>((resolve) => {
      const exitDisposable = ptyProcess.onExit(({ exitCode }) => {
        dataDisposable.dispose();
        exitDisposable.dispose();
        options.stdin.off('data', stdinDataHandler);
        stdout.off('resize', stdoutResizeHandler);
        restoreTerminal?.();
        resolve({
          exitCode,
          quotaError: quotaDetected || evaluateQuotaOutput(sanitizedOutput),
          output: sanitizedOutput,
          retryAvailability: quotaDetected ? extractQuotaRetryAvailability(sanitizedOutput) : null
        });
      });
    });
  }

  const child = spawn(shell, ['-lc', command], {
    cwd: options.workspaceDir,
    env: toPtyEnv({
      ...options.env,
      CODEX_HOME: options.instanceDir
    }),
    stdio: 'pipe'
  });
  let quotaDetected = false;

  const triggerQuotaRotation = (): void => {
    if (quotaDetected || !evaluateQuotaOutput(sanitizedOutput)) {
      return;
    }

    quotaDetected = true;
    child.kill('SIGTERM');
  };

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const data = chunk.toString();
    stdout.write(data);
    sanitizedOutput = `${sanitizedOutput}${sanitizeTerminalOutput(data)}`.slice(-20000);
    triggerQuotaRotation();
  });

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const data = chunk.toString();
    stdout.write(data);
    sanitizedOutput = `${sanitizedOutput}${sanitizeTerminalOutput(data)}`.slice(-20000);
    triggerQuotaRotation();
  });

  return new Promise<InvocationResult>((resolve) => {
    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        quotaError: quotaDetected || evaluateQuotaOutput(sanitizedOutput),
        output: `${sanitizedOutput}\n${error.message}`,
        retryAvailability: quotaDetected ? extractQuotaRetryAvailability(sanitizedOutput) : null
      });
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        quotaError: quotaDetected || evaluateQuotaOutput(sanitizedOutput),
        output: sanitizedOutput,
        retryAvailability: quotaDetected ? extractQuotaRetryAvailability(sanitizedOutput) : null
      });
    });
  });
}

function buildInstanceId(): string {
  return `${Date.now()}-${process.pid}-${randomUUID()}`;
}

export async function runManagedSession(options: RunManagedSessionOptions): Promise<RunManagedSessionResult> {
  await ensureAppLayout(options.appHome);
  const logger = await createSessionLogger(options.appHome);
  const stdout = options.stdout ?? (process.stdout as OutputLike);
  const stderr = options.stderr ?? (process.stderr as OutputLike);
  const stdin = options.stdin ?? process.stdin;
  const env = {
    ...process.env,
    ...options.env
  };
  const codexHome = options.codexHome ?? resolveCodexHome(env);
  const codexCommand = options.codexCommand ?? resolveCodexCommand(env);
  const interactive =
    (options.interactive ?? canUseInteractiveTerminal(stdin, stdout, stderr)) &&
    canUseInteractiveTerminal(stdin, stdout, stderr);
  let switchCount = 0;

  const state = await loadState(options.appHome);
  let current = options.preferredAccountName
    ? getAccountByName(state, options.preferredAccountName)
    : getPreferredAccount(state) ?? getCurrentAccount(state);
  if (!current) {
    if (state.accounts.length === 0) {
      throw new Error('No accounts configured. Run `codex-auto add <name>` first.');
    }

    throw new Error(`Account "${options.preferredAccountName}" does not exist.`);
  }

  const exhausted = new Set<string>();
  let firstRun = true;
  let lastSessionId: string | null = null;
  const instanceId = buildInstanceId();
  const runId = instanceId;
  const instanceDir = instanceHome(options.appHome, instanceId);
  const authPath = accountAuthPath(options.appHome, current.name);
  let sessionBindingLost = false;
  const runStartedAt = new Date().toISOString();

  await writeManagedRunState(options.appHome, {
    runId,
    pid: process.pid,
    workspaceDir: options.workspaceDir,
    startedAt: runStartedAt,
    status: 'running',
    currentAccount: current.name,
    currentSessionId: null,
    sessionBindingLost
  });

  await createInstanceOverlay(codexHome, instanceDir, authPath);

  try {
    while (true) {
      let knownSessionIds = new Set<string>();
      let launchStartedAt = 0;
      if (firstRun && !lastSessionId) {
        knownSessionIds = await snapshotKnownSessionIds(instanceDir);
        launchStartedAt = Date.now();
      }

      await logger.log('launch', {
        account: current.name,
        resume: !firstRun,
        sessionId: firstRun ? null : lastSessionId,
        instanceId
      });

      const firstRunArgs = buildFirstRunArgs(options.extraArgs ?? []);

      const result = firstRun
        ? await launchInvocation({
            appHome: options.appHome,
            instanceDir,
            workspaceDir: options.workspaceDir,
            codexCommand,
            args: firstRunArgs,
            env,
            stdin,
            stdout,
            interactive
          })
        : await launchResumeInvocation({
            appHome: options.appHome,
            instanceDir,
            workspaceDir: options.workspaceDir,
            codexCommand,
            env,
            stdin,
            stdout,
            interactive,
            sessionId: lastSessionId as string
          });

      const discoveredSessionId: string | null = firstRun && !lastSessionId
        ? await discoverSessionId({
            instanceDir,
            workspaceDir: options.workspaceDir,
            launchStartedAt,
            knownSessionIds
          })
        : null;
      if (discoveredSessionId && !lastSessionId) {
        lastSessionId = discoveredSessionId;
        await persistLastSessionId(options.appHome, discoveredSessionId);
        await writeManagedRunState(options.appHome, {
          runId,
          pid: process.pid,
          workspaceDir: options.workspaceDir,
          startedAt: runStartedAt,
          status: 'running',
          currentAccount: current.name,
          currentSessionId: discoveredSessionId,
          sessionBindingLost
        });
      }

      if (!firstRun && result.exitCode !== 0 && hasMissingSessionError(result.output)) {
        sessionBindingLost = true;
        stderr.write('\n[codex-auto] Unable to safely resume bound session: saved session id is no longer available.\n');
        await writeManagedRunState(options.appHome, {
          runId,
          pid: process.pid,
          workspaceDir: options.workspaceDir,
          startedAt: runStartedAt,
          status: 'recovery_failed',
          currentAccount: current.name,
          currentSessionId: lastSessionId,
          sessionBindingLost
        });

        return {
          finalAccount: current.name,
          switchCount,
          exitCode: result.exitCode || 1,
          exhaustedAll: false
        };
      }

      if (!result.quotaError) {
        const latestState = await loadState(options.appHome);
        latestState.currentIndex = current.index;
        latestState.lastSuccessfulAccount = current.name;
        latestState.lastSessionId = lastSessionId;
        delete latestState.retryAvailabilityByAccount[current.name];
        await saveState(options.appHome, latestState);
        await markAccountUsed(options.appHome, current.name);
        await logger.log('exit', { account: current.name, exitCode: result.exitCode, instanceId });
        await writeManagedRunState(options.appHome, {
          runId,
          pid: process.pid,
          workspaceDir: options.workspaceDir,
          startedAt: runStartedAt,
          status: 'exited',
          currentAccount: current.name,
          currentSessionId: lastSessionId,
          sessionBindingLost
        });

        return {
          finalAccount: current.name,
          switchCount,
          exitCode: result.exitCode,
          exhaustedAll: false
        };
      }

      exhausted.add(current.name);
      const latestState = await loadState(options.appHome);
      if (result.retryAvailability) {
        latestState.retryAvailabilityByAccount[current.name] = result.retryAvailability;
      }
      const next = pickNextAccount(latestState.accounts, current.index, exhausted);
      await logger.log('quota_switch', {
        from: current.name,
        exhausted: [...exhausted],
        instanceId
      });

      if (!next) {
        latestState.currentIndex = current.index;
        latestState.lastSessionId = lastSessionId;
        await saveState(options.appHome, latestState);
        stderr.write('\n[codex-auto] All configured accounts are exhausted.\n');
        await logger.log('all_exhausted', {
          finalAccount: current.name,
          instanceId
        });
        await writeManagedRunState(options.appHome, {
          runId,
          pid: process.pid,
          workspaceDir: options.workspaceDir,
          startedAt: runStartedAt,
          status: 'failed',
          currentAccount: current.name,
          currentSessionId: lastSessionId,
          sessionBindingLost
        });

        return {
          finalAccount: current.name,
          switchCount,
          exitCode: result.exitCode || 1,
          exhaustedAll: true
        };
      }

      if (!lastSessionId) {
        sessionBindingLost = true;
        stderr.write('\n[codex-auto] Unable to safely resume bound session: no session id was captured for this run.\n');
        await writeManagedRunState(options.appHome, {
          runId,
          pid: process.pid,
          workspaceDir: options.workspaceDir,
          startedAt: runStartedAt,
          status: 'recovery_failed',
          currentAccount: current.name,
          currentSessionId: null,
          sessionBindingLost
        });

        return {
          finalAccount: current.name,
          switchCount,
          exitCode: result.exitCode || 1,
          exhaustedAll: false
        };
      }

      switchCount += 1;
      stderr.write(`\n[codex-auto] ${current.name} hit a quota limit. Switching to ${next.name} and resuming...\n`);
      latestState.currentIndex = next.index;
      latestState.lastSessionId = lastSessionId;
      await saveState(options.appHome, latestState);
      current = next;
      firstRun = false;
      await replaceOverlayAuth(instanceDir, accountAuthPath(options.appHome, current.name));
      await writeManagedRunState(options.appHome, {
        runId,
        pid: process.pid,
        workspaceDir: options.workspaceDir,
        startedAt: runStartedAt,
        status: 'running',
        currentAccount: current.name,
        currentSessionId: lastSessionId,
        sessionBindingLost
      });
    }
  } finally {
    await cleanupInstanceOverlay(instanceDir);
  }
}
