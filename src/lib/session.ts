import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { spawn as spawnPty } from 'node-pty';
import path from 'node:path';
import { createSessionLogger } from './logger.js';
import { buildCodexShellCommand, resolveCodexCommand } from './codex-bin.js';
import { extractQuotaRetryAvailability, getOutputSinceLatestPrompt, hasQuotaError, sanitizeTerminalOutput } from './detection.js';
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
  interrupted: boolean;
};

const quotaShutdownGraceMs = 250;
const prePromptQuotaDecisionGraceMs = 150;
const postPromptQuotaConfirmationMs = 5_000;
const sessionDiscoveryPollIntervalMs = 50;
const sessionDiscoveryTimeoutOnQuotaMs = 1_000;
const terminalRestoreSequence = [
  '\u001b[?1l',
  '\u001b[<u',
  '\u001b[>4;0m',
  '\u001b[?2004l',
  '\u001b[?1000l',
  '\u001b[?1002l',
  '\u001b[?1003l',
  '\u001b[?1004l',
  '\u001b[?1005l',
  '\u001b[?1006l',
  '\u001b[?1015l',
  '\u001b[?1047l',
  '\u001b[?1049l',
  '\u001b[?25h',
  '\u001b>'
].join('');

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function restoreTerminalModes(stdout: OutputLike): void {
  if (!stdout.isTTY) {
    return;
  }

  stdout.write(terminalRestoreSequence);
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

const resumeOptionsWithValue = new Set([
  '-c',
  '--config',
  '--enable',
  '--disable',
  '--remote',
  '--remote-auth-token-env',
  '-i',
  '--image',
  '-m',
  '--model',
  '--local-provider',
  '-p',
  '--profile',
  '-s',
  '--sandbox',
  '-a',
  '--ask-for-approval',
  '-C',
  '--cd',
  '--add-dir'
]);

type InitialResumeTarget = {
  explicitSessionId: string | null;
  useLast: boolean;
  includeAll: boolean;
};

function parseDateMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractInitialResumeTarget(args: string[]): InitialResumeTarget | null {
  const firstPositionalIndex = args.findIndex((arg) => !arg.startsWith('-'));
  if (firstPositionalIndex === -1 || args[firstPositionalIndex] !== 'resume') {
    return null;
  }

  let explicitSessionId: string | null = null;
  let useLast = false;
  let includeAll = false;

  for (let index = firstPositionalIndex + 1; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === '--last') {
      useLast = true;
      continue;
    }

    if (arg === '--all') {
      includeAll = true;
      continue;
    }

    if (arg === '--') {
      const sessionId = args[index + 1];
      if (!useLast && sessionId && !sessionId.startsWith('-')) {
        explicitSessionId = sessionId;
      }
      break;
    }

    if (arg.startsWith('--')) {
      const equalsIndex = arg.indexOf('=');
      const optionName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
      if (resumeOptionsWithValue.has(optionName)) {
        if (equalsIndex === -1) {
          index += 1;
        }
        continue;
      }
    } else if (resumeOptionsWithValue.has(arg)) {
      index += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    if (!useLast) {
      explicitSessionId = arg;
    }
    break;
  }

  if (!useLast && !explicitSessionId) {
    return null;
  }

  return {
    explicitSessionId,
    useLast,
    includeAll
  };
}

function mergeSessionCandidates(candidates: SessionCandidate[]): SessionCandidate[] {
  const merged = new Map<string, SessionCandidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.id);
    if (!existing) {
      merged.set(candidate.id, candidate);
      continue;
    }

    merged.set(candidate.id, {
      id: candidate.id,
      cwd: existing.cwd ?? candidate.cwd,
      timestampMs: Math.max(existing.timestampMs, candidate.timestampMs)
    });
  }

  return [...merged.values()];
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

function selectLatestSessionCandidate(
  candidates: SessionCandidate[],
  workspaceDir: string,
  includeAll: boolean
): string | null {
  const merged = mergeSessionCandidates(candidates);
  const filtered = includeAll
    ? merged
    : merged.filter((candidate) => candidate.cwd === workspaceDir || candidate.cwd === null);
  const cwdMatched = includeAll ? filtered : filtered.filter((candidate) => candidate.cwd === workspaceDir);
  const ranked = (cwdMatched.length > 0 ? cwdMatched : filtered.length > 0 ? filtered : merged).sort(
    (left, right) => right.timestampMs - left.timestampMs
  );
  return ranked[0]?.id ?? null;
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
  const discoveredFromIndex = selectBestSessionCandidate(newIndexCandidates, options.workspaceDir, options.launchStartedAt);
  if (discoveredFromIndex) {
    return discoveredFromIndex;
  }

  // Fall back to mtime-based discovery for pre-existing sessions resumed via interactive picker
  const resumedFileCandidates = await readSessionCandidatesFromFilesByMtime(options.instanceDir, options.launchStartedAt);
  return selectBestSessionCandidate(resumedFileCandidates, options.workspaceDir, options.launchStartedAt);
}

async function resolveInitialResumeSessionId(options: {
  args: string[];
  instanceDir: string;
  workspaceDir: string;
}): Promise<string | null> {
  const target = extractInitialResumeTarget(options.args);
  if (!target) {
    return null;
  }

  if (target.explicitSessionId) {
    return target.explicitSessionId;
  }

  const [fromFiles, fromIndex] = await Promise.all([
    readSessionCandidatesFromFiles(options.instanceDir),
    readSessionCandidatesFromIndex(options.instanceDir)
  ]);

  return selectLatestSessionCandidate([...fromFiles, ...fromIndex], options.workspaceDir, target.includeAll);
}

async function waitForSessionId(options: {
  instanceDir: string;
  workspaceDir: string;
  launchStartedAt: number;
  knownSessionIds: Set<string>;
  timeoutMs: number;
}): Promise<string | null> {
  const deadline = Date.now() + Math.max(0, options.timeoutMs);

  while (true) {
    const discovered = await discoverSessionId(options);
    if (discovered) {
      return discovered;
    }

    if (Date.now() >= deadline) {
      return null;
    }

    await sleep(sessionDiscoveryPollIntervalMs);
  }
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

async function readSessionCandidatesFromFilesByMtime(
  instanceDir: string,
  since: number
): Promise<SessionCandidate[]> {
  const sessionFiles = await collectSessionFiles(path.join(instanceDir, 'sessions'));
  const candidates: SessionCandidate[] = [];

  for (const sessionFile of sessionFiles) {
    let mtimeMs: number;
    try {
      const fileInfo = await stat(sessionFile);
      mtimeMs = fileInfo.mtimeMs;
    } catch {
      continue;
    }

    if (mtimeMs < since) {
      continue;
    }

    const fileText = await readTextIfExists(sessionFile);
    const firstLine = fileText?.split('\n').find((line) => line.trim().length > 0);
    let id: string | null = null;
    let cwd: string | null = null;

    if (firstLine) {
      try {
        const parsed = JSON.parse(firstLine) as {
          type?: unknown;
          payload?: { id?: unknown; cwd?: unknown };
        };
        if (parsed.type === 'session_meta' && typeof parsed.payload?.id === 'string') {
          id = parsed.payload.id;
          cwd = typeof parsed.payload.cwd === 'string' ? parsed.payload.cwd : null;
        }
      } catch {
        // fall through to filename extraction
      }
    }

    if (!id) {
      const match = path.basename(sessionFile).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
      if (match) {
        id = match[1]!;
      }
    }

    if (id) {
      candidates.push({ id, cwd, timestampMs: mtimeMs });
    }
  }

  return candidates;
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
  let sanitizedOutput = '';
  let quotaRelevantOutput = '';
  let pendingPrePromptQuotaTimer: NodeJS.Timeout | null = null;
  let pendingPostPromptQuotaTimer: NodeJS.Timeout | null = null;

  const clearPendingPrePromptQuotaTimer = (): void => {
    if (!pendingPrePromptQuotaTimer) {
      return;
    }

    clearTimeout(pendingPrePromptQuotaTimer);
    pendingPrePromptQuotaTimer = null;
  };

  const clearPendingPostPromptQuotaTimer = (): void => {
    if (!pendingPostPromptQuotaTimer) {
      return;
    }

    clearTimeout(pendingPostPromptQuotaTimer);
    pendingPostPromptQuotaTimer = null;
  };

  const evaluateQuotaOutput = (): {
    quotaError: boolean;
    sawPrompt: boolean;
    relevantOutput: string;
  } => {
    const outputSinceLatestPrompt = getOutputSinceLatestPrompt(sanitizedOutput);
    if (outputSinceLatestPrompt !== null) {
      return {
        quotaError: hasQuotaError(outputSinceLatestPrompt),
        sawPrompt: true,
        relevantOutput: outputSinceLatestPrompt
      };
    }

    return {
      quotaError: hasQuotaError(sanitizedOutput),
      sawPrompt: false,
      relevantOutput: sanitizedOutput
    };
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
            retryAvailability: null,
            interrupted: false
          });
        });

        child.on('close', (code) => {
          resolve({
            exitCode: code ?? 1,
            quotaError: false,
            output: '',
            retryAvailability: null,
            interrupted: false
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
    let quotaShutdownTimer: NodeJS.Timeout | null = null;
    let interrupted = false;

    const stopPtyForQuota = (): void => {
      if (quotaShutdownTimer) {
        return;
      }

      quotaShutdownTimer = setTimeout(() => {
        ptyProcess.kill('SIGTERM');
      }, quotaShutdownGraceMs);
    };

    const stdinDataHandler = (chunk: Buffer | string): void => {
      const input = chunk.toString();
      if (quotaDetected || pendingPrePromptQuotaTimer || pendingPostPromptQuotaTimer) {
        if (!interrupted && input.includes('\u0003')) {
          interrupted = true;
          clearPendingPrePromptQuotaTimer();
          clearPendingPostPromptQuotaTimer();
          if (quotaShutdownTimer) {
            clearTimeout(quotaShutdownTimer);
            quotaShutdownTimer = null;
          }
          ptyProcess.kill('SIGINT');
        }
        return;
      }

      ptyProcess.write(input);
    };
    const stdoutResizeHandler = (): void => {
      const nextSize = getTerminalSize(stdout);
      ptyProcess.resize(nextSize.cols, nextSize.rows);
    };

    options.stdin.on('data', stdinDataHandler);
    stdout.on('resize', stdoutResizeHandler);
    const restoreTerminal = enterRawMode(options.stdin);

    const handlePotentialQuota = (): void => {
      if (quotaDetected) {
        return;
      }

      const evaluation = evaluateQuotaOutput();
      if (evaluation.sawPrompt) {
        clearPendingPrePromptQuotaTimer();
        if (!evaluation.quotaError) {
          clearPendingPostPromptQuotaTimer();
          return;
        }

        clearPendingPostPromptQuotaTimer();
        pendingPostPromptQuotaTimer = setTimeout(() => {
          pendingPostPromptQuotaTimer = null;
          if (quotaDetected) {
            return;
          }

          const confirmedEvaluation = evaluateQuotaOutput();
          if (!confirmedEvaluation.sawPrompt || !confirmedEvaluation.quotaError) {
            return;
          }

          quotaDetected = true;
          quotaRelevantOutput = confirmedEvaluation.relevantOutput;
          stopPtyForQuota();
        }, postPromptQuotaConfirmationMs);
        return;
      }

      clearPendingPostPromptQuotaTimer();
      if (!evaluation.quotaError) {
        clearPendingPrePromptQuotaTimer();
        return;
      }

      if (pendingPrePromptQuotaTimer) {
        return;
      }

      pendingPrePromptQuotaTimer = setTimeout(() => {
        pendingPrePromptQuotaTimer = null;
        if (quotaDetected) {
          return;
        }

        const delayedEvaluation = evaluateQuotaOutput();
        if (delayedEvaluation.sawPrompt || !delayedEvaluation.quotaError) {
          return;
        }

        quotaDetected = true;
        quotaRelevantOutput = delayedEvaluation.relevantOutput;
        stopPtyForQuota();
      }, prePromptQuotaDecisionGraceMs);
    };

    const dataDisposable = ptyProcess.onData((data) => {
      stdout.write(data);
      sanitizedOutput = `${sanitizedOutput}${sanitizeTerminalOutput(data)}`.slice(-20000);
      handlePotentialQuota();
    });

    return new Promise<InvocationResult>((resolve) => {
      const exitDisposable = ptyProcess.onExit(({ exitCode }) => {
        dataDisposable.dispose();
        exitDisposable.dispose();
        options.stdin.off('data', stdinDataHandler);
        stdout.off('resize', stdoutResizeHandler);
        restoreTerminal?.();
        clearPendingPrePromptQuotaTimer();
        clearPendingPostPromptQuotaTimer();
        if (quotaShutdownTimer) {
          clearTimeout(quotaShutdownTimer);
        }
        restoreTerminalModes(stdout);
        const finalEvaluation = quotaDetected
          ? {
              quotaError: true,
              relevantOutput: quotaRelevantOutput
            }
          : evaluateQuotaOutput();
        resolve({
          exitCode,
          quotaError: finalEvaluation.quotaError,
          output: sanitizedOutput,
          retryAvailability: finalEvaluation.quotaError ? extractQuotaRetryAvailability(finalEvaluation.relevantOutput) : null,
          interrupted
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
  let quotaShutdownTimer: NodeJS.Timeout | null = null;

  const stopChildForQuota = (): void => {
    if (quotaShutdownTimer) {
      return;
    }

    quotaShutdownTimer = setTimeout(() => {
      child.kill('SIGTERM');
    }, quotaShutdownGraceMs);
  };

  const triggerQuotaRotation = (): void => {
    if (quotaDetected) {
      return;
    }

    const evaluation = evaluateQuotaOutput();
    if (evaluation.sawPrompt) {
      clearPendingPrePromptQuotaTimer();
      if (!evaluation.quotaError) {
        clearPendingPostPromptQuotaTimer();
        return;
      }

      clearPendingPostPromptQuotaTimer();
      pendingPostPromptQuotaTimer = setTimeout(() => {
        pendingPostPromptQuotaTimer = null;
        if (quotaDetected) {
          return;
        }

        const confirmedEvaluation = evaluateQuotaOutput();
        if (!confirmedEvaluation.sawPrompt || !confirmedEvaluation.quotaError) {
          return;
        }

        quotaDetected = true;
        quotaRelevantOutput = confirmedEvaluation.relevantOutput;
        stopChildForQuota();
      }, postPromptQuotaConfirmationMs);
      return;
    }

    clearPendingPostPromptQuotaTimer();
    if (!evaluation.quotaError) {
      clearPendingPrePromptQuotaTimer();
      return;
    }

    if (pendingPrePromptQuotaTimer) {
      return;
    }

    pendingPrePromptQuotaTimer = setTimeout(() => {
      pendingPrePromptQuotaTimer = null;
      if (quotaDetected) {
        return;
      }

      const delayedEvaluation = evaluateQuotaOutput();
      if (delayedEvaluation.sawPrompt || !delayedEvaluation.quotaError) {
        return;
      }

      quotaDetected = true;
      quotaRelevantOutput = delayedEvaluation.relevantOutput;
      stopChildForQuota();
    }, prePromptQuotaDecisionGraceMs);
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
      clearPendingPrePromptQuotaTimer();
      clearPendingPostPromptQuotaTimer();
      if (quotaShutdownTimer) {
        clearTimeout(quotaShutdownTimer);
      }
      const finalEvaluation = quotaDetected
        ? {
            quotaError: true,
            relevantOutput: quotaRelevantOutput
          }
        : evaluateQuotaOutput();
      resolve({
        exitCode: 1,
        quotaError: finalEvaluation.quotaError,
        output: `${sanitizedOutput}\n${error.message}`,
        retryAvailability: finalEvaluation.quotaError ? extractQuotaRetryAvailability(finalEvaluation.relevantOutput) : null,
        interrupted: false
      });
    });

    child.on('close', (code) => {
      clearPendingPrePromptQuotaTimer();
      clearPendingPostPromptQuotaTimer();
      if (quotaShutdownTimer) {
        clearTimeout(quotaShutdownTimer);
      }
      const finalEvaluation = quotaDetected
        ? {
            quotaError: true,
            relevantOutput: quotaRelevantOutput
          }
        : evaluateQuotaOutput();
      resolve({
        exitCode: code ?? 1,
        quotaError: finalEvaluation.quotaError,
        output: sanitizedOutput,
        retryAvailability: finalEvaluation.quotaError ? extractQuotaRetryAvailability(finalEvaluation.relevantOutput) : null,
        interrupted: false
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
  lastSessionId = await resolveInitialResumeSessionId({
    args: options.extraArgs ?? [],
    instanceDir,
    workspaceDir: options.workspaceDir
  });

  // For bare `resume` with no explicit session ID or --last, fall back to the last known
  // session from state so that account switching can resume the correct session without
  // requiring the user to re-select from the picker on the new account.
  if (!lastSessionId) {
    const firstPositional = (options.extraArgs ?? []).find((a) => !a.startsWith('-'));
    if (firstPositional === 'resume') {
      lastSessionId = state.lastSessionId ?? null;
    }
  }

  if (lastSessionId) {
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

      const result: InvocationResult = firstRun
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
        ? await waitForSessionId({
            instanceDir,
            workspaceDir: options.workspaceDir,
            launchStartedAt,
            knownSessionIds,
            timeoutMs: result.quotaError ? sessionDiscoveryTimeoutOnQuotaMs : 0
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

      if (result.interrupted) {
        const latestState = await loadState(options.appHome);
        latestState.currentIndex = current.index;
        if (hasMissingSessionError(result.output)) {
          latestState.lastSessionId = null;
        } else if (lastSessionId) {
          latestState.lastSessionId = lastSessionId;
        }
        if (result.retryAvailability) {
          latestState.retryAvailabilityByAccount[current.name] = result.retryAvailability;
        }
        await saveState(options.appHome, latestState);
        await logger.log('interrupt', { account: current.name, exitCode: result.exitCode, instanceId });
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
          exitCode: result.exitCode || 130,
          exhaustedAll: false
        };
      }

      if (!result.quotaError) {
        const latestState = await loadState(options.appHome);
        latestState.currentIndex = current.index;
        latestState.lastSuccessfulAccount = current.name;
        if (hasMissingSessionError(result.output)) {
          latestState.lastSessionId = null;
        } else if (lastSessionId) {
          latestState.lastSessionId = lastSessionId;
        }
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
        if (lastSessionId) {
          latestState.lastSessionId = lastSessionId;
        }
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
      if (lastSessionId) {
        latestState.lastSessionId = lastSessionId;
      }
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
