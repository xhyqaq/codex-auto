#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';

function resolveFilename(stdout) {
  const entries = JSON.parse(stdout);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('npm pack --json did not return any pack metadata');
  }

  const filename = entries.at(-1)?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack --json did not include a tarball filename');
  }

  return filename;
}

async function main() {
  const stdout = execFileSync('npm', ['pack', '--json', ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 10 * 1024 * 1024
  });

  const filename = resolveFilename(stdout);

  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `TARBALL=${filename}\n`, 'utf8');
  }

  process.stdout.write(`${filename}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
