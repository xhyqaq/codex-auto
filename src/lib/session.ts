import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import path from 'node:path';
import { acquireRuntimeLock } from './lock.js';
import { createSessionLogger } from './logger.js';
import { buildCodexShellCommand, resolveCodexCommand } from './codex-bin.js';
import { hasQuotaError, sanitizeTerminalOutput } from './detection.js';
import { getAccountByName, getCurrentAccount, pickNextAccount } from './rotation.js';
import { loadState, saveState } from './state.js';
import { logsRoot, runtimeHome } from './paths.js';
import { ensureAppLayout, syncRuntimeAccount } from './runtime.js';
import { markAccountUsed } from './accounts.js';
import { readTextIfExists } from './fs.js';

type OutputLike = Writable & {
  columns?: number;
  rows?: number;
  isTTY?: boolean;
};

export type RunManagedSessionOptions = {
  appHome: string;
  workspaceDir: string;
  preferredAccountName?: string;
  codexCommand?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: NodeJS.ReadStream;
  stdout?: OutputLike;
  stderr?: OutputLike;
  interactive?: boolean;
};

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

async function launchInvocation(options: {
  appHome: string;
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
  const runtimePath = runtimeHome(options.appHome);
  const stdout = options.stdout;
  let sanitizedOutput = '';

  if (options.interactive) {
    const transcriptPath = path.join(logsRoot(options.appHome), `typescript-${Date.now()}.log`);
    const child = spawn('script', ['-qF', transcriptPath, shell, '-lc', command], {
      cwd: options.workspaceDir,
      env: toPtyEnv({
        ...options.env,
        CODEX_HOME: runtimePath
      }),
      stdio: 'inherit'
    });
    let exitCode = 0;
    let quotaDetected = false;
    let polling = false;

    const pollTranscript = async (): Promise<void> => {
      if (polling || quotaDetected) {
        return;
      }

      polling = true;
      try {
        const transcript = await readTextIfExists(transcriptPath);
        const output = sanitizeTerminalOutput(transcript ?? '');
        if (hasQuotaError(output)) {
          quotaDetected = true;
          child.kill('SIGTERM');
        }
      } finally {
        polling = false;
      }
    };

    const interval = setInterval(() => {
      void pollTranscript();
    }, 200);

    return new Promise<InvocationResult>((resolve) => {
      child.on('error', async (error) => {
        clearInterval(interval);
        const transcript = await readTextIfExists(transcriptPath);
        const output = sanitizeTerminalOutput(transcript ?? '');
        resolve({
          exitCode: 1,
          quotaError: quotaDetected || hasQuotaError(output),
          output: `${output}\n${error.message}`.trim()
        });
      });

      child.on('close', async (code) => {
        clearInterval(interval);
        exitCode = code ?? 1;
        const transcript = await readTextIfExists(transcriptPath);
        const output = sanitizeTerminalOutput(transcript ?? '');
        resolve({
          exitCode,
          quotaError: quotaDetected || hasQuotaError(output),
          output
        });
      });
    });
  }

  const child = spawn(shell, ['-lc', command], {
        cwd: options.workspaceDir,
        env: toPtyEnv({
          ...options.env,
          CODEX_HOME: runtimePath
        }),
        stdio: 'pipe'
      });
  let exitCode = 0;
  let quotaDetected = false;

  const triggerQuotaRotation = (): void => {
    if (quotaDetected || !hasQuotaError(sanitizedOutput)) {
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

  const cleanupCallbacks: Array<() => void> = [];
  return new Promise<InvocationResult>((resolve) => {
    child.on('error', (error) => {
      for (const callback of cleanupCallbacks.reverse()) {
        callback();
      }

      resolve({
        exitCode: 1,
        quotaError: quotaDetected || hasQuotaError(sanitizedOutput),
        output: `${sanitizedOutput}\n${error.message}`
      });
    });

    child.on('close', (code) => {
      exitCode = code ?? 1;
      for (const callback of cleanupCallbacks.reverse()) {
        callback();
      }

      resolve({
        exitCode,
        quotaError: quotaDetected || hasQuotaError(sanitizedOutput),
        output: sanitizedOutput
      });
    });
  });
}

export async function runManagedSession(options: RunManagedSessionOptions): Promise<RunManagedSessionResult> {
  await ensureAppLayout(options.appHome);
  const releaseLock = await acquireRuntimeLock(options.appHome);
  const logger = await createSessionLogger(options.appHome);
  const stdout = options.stdout ?? (process.stdout as OutputLike);
  const stderr = options.stderr ?? (process.stderr as OutputLike);
  const stdin = options.stdin ?? process.stdin;
  const env = {
    ...process.env,
    ...options.env
  };
  const codexCommand = options.codexCommand ?? resolveCodexCommand(env);
  const interactive =
    (options.interactive ?? canUseInteractiveTerminal(stdin, stdout, stderr)) &&
    canUseInteractiveTerminal(stdin, stdout, stderr);
  let switchCount = 0;

  try {
    const state = await loadState(options.appHome);
    let current = options.preferredAccountName
      ? getAccountByName(state, options.preferredAccountName)
      : getCurrentAccount(state);
    if (!current) {
      if (state.accounts.length === 0) {
        throw new Error('No accounts configured. Run `codex-auto add <name>` first.');
      }

      throw new Error(`Account "${options.preferredAccountName}" does not exist.`);
    }

    const exhausted = new Set<string>();
    let firstRun = true;

    while (true) {
      await syncRuntimeAccount(options.appHome, current.name, options.workspaceDir);
      await logger.log('launch', {
        account: current.name,
        resume: !firstRun
      });

      const args = firstRun ? ['--no-alt-screen'] : ['resume', '--last', '--no-alt-screen', '继续'];
      const result = await launchInvocation({
        appHome: options.appHome,
        workspaceDir: options.workspaceDir,
        codexCommand,
        args,
        env,
        stdin,
        stdout,
        interactive
      });

      if (!result.quotaError) {
        const latestState = await loadState(options.appHome);
        latestState.currentIndex = current.index;
        latestState.lastSuccessfulAccount = current.name;
        await saveState(options.appHome, latestState);
        await markAccountUsed(options.appHome, current.name);
        await logger.log('exit', { account: current.name, exitCode: result.exitCode });

        return {
          finalAccount: current.name,
          switchCount,
          exitCode: result.exitCode,
          exhaustedAll: false
        };
      }

      exhausted.add(current.name);
      const next = pickNextAccount(state.accounts, current.index, exhausted);
      await logger.log('quota_switch', {
        from: current.name,
        exhausted: [...exhausted]
      });

      if (!next) {
        const latestState = await loadState(options.appHome);
        latestState.currentIndex = current.index;
        await saveState(options.appHome, latestState);
        stderr.write(`\n[codex-auto] All configured accounts are exhausted.\n`);
        await logger.log('all_exhausted', {
          finalAccount: current.name
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
      current = next;
      const latestState = await loadState(options.appHome);
      latestState.currentIndex = next.index;
      await saveState(options.appHome, latestState);
      firstRun = false;
    }
  } finally {
    await releaseLock();
  }
}
