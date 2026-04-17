import { Command } from 'commander';
import type { Writable } from 'node:stream';
import { addAccount, removeAccount, renderAccountList } from './lib/accounts.js';
import { runCodexLogin, resolveCodexCommand } from './lib/codex-bin.js';
import { resolveAppHome } from './lib/paths.js';
import { loadState } from './lib/state.js';
import { ensureAppLayout } from './lib/runtime.js';
import { runManagedSession } from './lib/session.js';

type OutputLike = Writable & {
  columns?: number;
  rows?: number;
  isTTY?: boolean;
};

export type CliRunOptions = {
  appHome?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: NodeJS.ReadStream;
  stdout?: OutputLike;
  stderr?: OutputLike;
  interactive?: boolean;
};

function canUseInteractiveTerminal(
  stdin: NodeJS.ReadStream,
  stdout: OutputLike,
  stderr: OutputLike
): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY && stderr.isTTY);
}

export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<number> {
  const env = {
    ...process.env,
    ...options.env
  };
  const appHome = options.appHome ?? resolveAppHome(env);
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? (process.stdout as OutputLike);
  const stderr = options.stderr ?? (process.stderr as OutputLike);
  const stdin = options.stdin ?? process.stdin;
  const interactive =
    (options.interactive ?? canUseInteractiveTerminal(stdin, stdout, stderr)) &&
    canUseInteractiveTerminal(stdin, stdout, stderr);
  let exitCode = 0;

  await ensureAppLayout(appHome);

  const program = new Command();
  program
    .name('codex-auto')
    .option('--account <name>', 'Start this run from a specific account')
    .showHelpAfterError()
    .configureOutput({
      writeOut: (message) => stdout.write(message),
      writeErr: (message) => stderr.write(message)
    })
    .exitOverride();

  program.command('list').action(async () => {
    const state = await loadState(appHome);
    stdout.write(`${renderAccountList(state)}\n`);
    exitCode = 0;
  });

  program
    .command('add')
    .argument('<name>')
    .option('--config <path>', 'Import an existing account config.toml')
    .option('--auth <path>', 'Import an existing auth.json and skip interactive login')
    .action(async (name: string, command: { config?: string; auth?: string }) => {
      await addAccount(appHome, name, {
        configPath: command.config,
        authPath: command.auth,
        runLogin: async (accountHome) => {
          await runCodexLogin({
            accountHome,
            cwd,
            env,
            codexCommand: resolveCodexCommand(env)
          });
        }
      });
      stdout.write(`Added account ${name}\n`);
      exitCode = 0;
    });

  program.command('remove').argument('<name>').action(async (name: string) => {
    await removeAccount(appHome, name);
    stdout.write(`Removed account ${name}\n`);
    exitCode = 0;
  });

  program.action(async () => {
    const state = await loadState(appHome);
    if (state.accounts.length === 0) {
      stderr.write('No accounts configured. Run `codex-auto add <name>` first.\n');
      exitCode = 1;
      return;
    }

    const result = await runManagedSession({
      appHome,
      workspaceDir: cwd,
      preferredAccountName: program.opts<{ account?: string }>().account,
      env,
      stdin,
      stdout,
      stderr,
      interactive
    });

    exitCode = result.exhaustedAll ? 1 : result.exitCode;
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
    return exitCode;
  } catch (error) {
    const commandError = error as { code?: string; exitCode?: number };
    if (commandError.code === 'commander.helpDisplayed') {
      return 0;
    }

    if (commandError.code === 'commander.executeSubCommandAsync') {
      return exitCode;
    }

    if (error instanceof Error) {
      stderr.write(`${error.message}\n`);
    }

    return commandError.exitCode ?? 1;
  }
}
