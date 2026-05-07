import { execFileSync, spawn } from 'node:child_process';
import type { Writable } from 'node:stream';

export function resolveCodexCommand(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CODEX_AUTO_CODEX_BIN?.trim();
  if (explicit) {
    return explicit;
  }

  // Resolve the full path to `codex` using the current environment's PATH so that
  // spawning through a login shell (`zsh -lc`) does not pick up a stale installation
  // from a different PATH entry order.
  try {
    const resolved = execFileSync('which', ['codex'], {
      encoding: 'utf8',
      env: { PATH: env.PATH ?? process.env.PATH }
    }).trim();
    if (resolved) {
      return resolved;
    }
  } catch {
    // fall through to bare name
  }

  return 'codex';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCodexShellCommand(codexCommand: string, args: string[]): string {
  const renderedArgs = args.map(shellQuote).join(' ');
  return renderedArgs ? `${codexCommand} ${renderedArgs}` : codexCommand;
}

function splitCommandLine(commandLine: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(commandLine)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return parts;
}

export async function runCodexLogin(options: {
  accountHome: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  codexCommand?: string;
}): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    CODEX_HOME: options.accountHome
  };

  const codexCommand = options.codexCommand ?? resolveCodexCommand(env);
  const shell = env.SHELL || '/bin/zsh';
  const command = buildCodexShellCommand(codexCommand, ['login']);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(shell, ['-lc', command], {
      cwd: options.cwd,
      env,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex login exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

export async function runCodexApp(options: {
  codexHome: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  codexCommand?: string;
  args?: string[];
  stdout?: Writable;
  stderr?: Writable;
}): Promise<number> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    CODEX_HOME: options.codexHome
  };

  const codexCommand = options.codexCommand ?? resolveCodexCommand(env);
  const [command, ...prefixArgs] = splitCommandLine(codexCommand);
  if (!command) {
    options.stderr?.write('Missing codex command\n');
    return 1;
  }

  return new Promise<number>((resolve) => {
    const child = spawn(command, [...prefixArgs, 'app', ...(options.args ?? [])], {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      options.stdout?.write(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      options.stderr?.write(chunk);
    });

    child.on('error', (error) => {
      options.stderr?.write(`${error.message}\n`);
      resolve(1);
    });

    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}
