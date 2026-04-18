import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
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
import { ensureAppLayout, cleanupInstanceOverlay, createInstanceOverlay } from './runtime.js';
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

async function readLatestSessionId(instanceDir: string): Promise<string | null> {
  const indexText = await readTextIfExists(path.join(instanceDir, 'session_index.jsonl'));
  if (indexText) {
    const lines = indexText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { id?: unknown };
        if (typeof parsed.id === 'string' && parsed.id.length > 0) {
          return parsed.id;
        }
      } catch {
        continue;
      }
    }
  }

  return readLatestSessionIdFromFiles(instanceDir);
}

async function readLatestSessionIdFromFiles(instanceDir: string): Promise<string | null> {
  const sessionFiles = await collectSessionFiles(path.join(instanceDir, 'sessions'));
  const latestFile = sessionFiles.sort().at(-1);
  if (!latestFile) {
    return null;
  }

  const fileText = await readTextIfExists(latestFile);
  const firstLine = fileText?.split('\n').find((line) => line.trim().length > 0);
  if (firstLine) {
    try {
      const parsed = JSON.parse(firstLine) as { payload?: { id?: unknown } };
      if (typeof parsed.payload?.id === 'string' && parsed.payload.id.length > 0) {
        return parsed.payload.id;
      }
    } catch {
      // Fall through to filename parsing.
    }
  }

  const match = path.basename(latestFile).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
  return match?.[1] ?? null;
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
  sessionId: string | null;
  logger: Awaited<ReturnType<typeof createSessionLogger>>;
}): Promise<InvocationResult> {
  if (options.sessionId) {
    const byIdResult = await launchInvocation({
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

    if (!byIdResult.quotaError && byIdResult.exitCode !== 0 && hasMissingSessionError(byIdResult.output)) {
      await options.logger.log('resume_fallback_last', {
        sessionId: options.sessionId
      });
    } else {
      return byIdResult;
    }
  }

  return launchInvocation({
    appHome: options.appHome,
    instanceDir: options.instanceDir,
    workspaceDir: options.workspaceDir,
    codexCommand: options.codexCommand,
    args: ['resume', '--last', '--no-alt-screen'],
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

function buildInstanceId(sequence: number): string {
  return `${Date.now()}-${process.pid}-${sequence}`;
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
  let overlaySequence = 0;

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
  let lastSessionId = state.lastSessionId;

  while (true) {
    const instanceId = buildInstanceId(overlaySequence);
    overlaySequence += 1;
    const instanceDir = instanceHome(options.appHome, instanceId);
    const authPath = accountAuthPath(options.appHome, current.name);

    await createInstanceOverlay(codexHome, instanceDir, authPath);
    await logger.log('launch', {
      account: current.name,
      resume: !firstRun,
      sessionId: firstRun ? null : lastSessionId,
      instanceId
    });

    try {
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
            sessionId: lastSessionId,
            logger
          });

      const discoveredSessionId = await readLatestSessionId(instanceDir);
      if (discoveredSessionId) {
        lastSessionId = discoveredSessionId;
        await persistLastSessionId(options.appHome, discoveredSessionId);
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

        return {
          finalAccount: current.name,
          switchCount,
          exitCode: result.exitCode || 1,
          exhaustedAll: true
        };
      }

      switchCount += 1;
      stderr.write(`\n[codex-auto] ${current.name} hit a quota limit. Switching to ${next.name} and resuming...\n`);
      latestState.currentIndex = next.index;
      latestState.lastSessionId = lastSessionId;
      await saveState(options.appHome, latestState);
      current = next;
      firstRun = false;
    } finally {
      await cleanupInstanceOverlay(instanceDir);
    }
  }
}
