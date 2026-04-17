#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const codexHome = process.env.CODEX_HOME;
const logPath = process.env.FAKE_CODEX_LOG;

if (!codexHome) {
  process.stderr.write('missing CODEX_HOME\n');
  process.exit(2);
}

mkdirSync(codexHome, { recursive: true });

const authPath = path.join(codexHome, 'auth.json');
const authText = existsSync(authPath) ? readFileSync(authPath, 'utf8') : '';

if (logPath) {
  appendFileSync(logPath, `${JSON.stringify({ args, authText })}\n`, 'utf8');
}

if (args[0] === 'login') {
  writeFileSync(authPath, JSON.stringify({ account: 'login-account', token: 'token' }, null, 2), 'utf8');
  process.stdout.write('login ok\n');
  process.exit(0);
}

if (authText.includes('"account": "a"') || authText.includes('"account":"a"')) {
  if (process.env.FAKE_CODEX_WAIT_ON_QUOTA === '1') {
    process.stdout.write("■ You've hit your usage limit. To get more access now, send a request to your admin.\n");
    process.stdout.write('Approaching rate limits\n');
    process.stdout.write('Switch to gpt-5.1-codex-mini for lower credit usage?\n');
    setInterval(() => {}, 1000);
  } else {
    process.stdout.write('Error: usage limit exceeded for this account\n');
    process.exit(1);
  }
}

if (args[0] === 'resume') {
  process.stdout.write(`Resumed with ${args.at(-1) ?? ''}\n`);
  process.exit(0);
}

process.stdout.write('session started\n');
process.exit(0);
