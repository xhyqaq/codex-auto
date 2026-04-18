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

export function extractAccountOption(argv: string[]): { accountName: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let accountName: string | undefined;
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === '--account' && i + 1 < argv.length) {
      accountName = argv[i + 1];
      i += 2;
    } else {
      rest.push(argv[i]!);
      i += 1;
    }
  }
  return { accountName, rest };
}

const ownCommands = new Set(['add', 'remove', 'list']);

export function isOwnCommand(rest: string[]): boolean {
  if (rest.includes('--help') || rest.includes('-h')) return true;
  if (rest.includes('--version') || rest.includes('-V')) return true;
  const firstPositional = rest.find((a) => !a.startsWith('-'));
  if (firstPositional && (ownCommands.has(firstPositional) || firstPositional === 'help')) return true;
  return false;
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

  await ensureAppLayout(appHome);

  const { accountName, rest } = extractAccountOption(argv);

  if (!isOwnCommand(rest)) {
    const state = await loadState(appHome);
    if (state.accounts.length === 0) {
      stderr.write('No accounts configured. Run `codex-auto add <name>` first.\n');
      return 1;
    }

    const result = await runManagedSession({
      appHome,
      workspaceDir: cwd,
      preferredAccountName: accountName,
      extraArgs: rest,
      env,
      stdin,
      stdout,
      stderr,
      interactive
    });

    return result.exhaustedAll ? 1 : result.exitCode;
  }

  let exitCode = 0;

  const program = new Command();
  program
    .name('codex-auto')
    .description('Multi-account switcher for the codex CLI.\nAll unrecognized arguments are forwarded to codex.')
    .option('--account <name>', 'Start this run from a specific account')
    .showHelpAfterError()
    .configureOutput({
      writeOut: (message) => stdout.write(message),
      writeErr: (message) => stderr.write(message)
    })
    .exitOverride();

  program.command('list').description('List configured accounts').action(async () => {
    const state = await loadState(appHome);
    stdout.write(`${renderAccountList(state)}\n`);
    exitCode = 0;
  });

  program
    .command('add')
    .description('Add a new account')
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

  program
    .command('remove')
    .description('Remove an account')
    .argument('<name>')
    .action(async (name: string) => {
      await removeAccount(appHome, name);
      stdout.write(`Removed account ${name}\n`);
      exitCode = 0;
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
