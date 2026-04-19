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
const sessionIndexPath = path.join(codexHome, 'session_index.jsonl');
const sessionId = process.env.FAKE_CODEX_SESSION_ID ?? 'session-from-index';
const sessionFilePath = path.join(codexHome, 'sessions', '2026', '04', '17', `rollout-2026-04-17T18-00-00-${sessionId}.jsonl`);
const authText = existsSync(authPath) ? readFileSync(authPath, 'utf8') : '';
const primaryTimestamp = new Date();
const primaryTimestampIso = primaryTimestamp.toISOString();
const competingTimestamp = new Date(primaryTimestamp.getTime() + 1000);
const competingTimestampIso = competingTimestamp.toISOString();

if (logPath) {
  appendFileSync(logPath, `${JSON.stringify({ args, authText })}\n`, 'utf8');
}

if (args[0] === 'login') {
  writeFileSync(authPath, JSON.stringify({ account: 'login-account', token: 'token' }, null, 2), 'utf8');
  process.stdout.write('login ok\n');
  process.exit(0);
}

mkdirSync(path.dirname(sessionFilePath), { recursive: true });
writeFileSync(
  sessionFilePath,
  `${JSON.stringify({
    timestamp: primaryTimestampIso,
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp: primaryTimestampIso,
      cwd: process.cwd()
    }
  })}\n`,
  'utf8'
);

if (process.env.FAKE_CODEX_SKIP_SESSION_INDEX !== '1') {
  writeFileSync(
    sessionIndexPath,
    `${JSON.stringify({
      id: sessionId,
      thread_name: 'fake-thread',
      updated_at: primaryTimestampIso
    })}\n`,
    'utf8'
  );
}

const competingSessionId = process.env.FAKE_CODEX_COMPETING_SESSION_ID;
if (competingSessionId) {
  const competingSessionCwd = process.env.FAKE_CODEX_COMPETING_SESSION_CWD ?? process.cwd();
  const competingSessionFilePath = path.join(
    codexHome,
    'sessions',
    '2026',
    '04',
    '17',
    `rollout-2026-04-17T18-00-01-${competingSessionId}.jsonl`
  );
  mkdirSync(path.dirname(competingSessionFilePath), { recursive: true });
  writeFileSync(
    competingSessionFilePath,
    `${JSON.stringify({
      timestamp: competingTimestampIso,
      type: 'session_meta',
      payload: {
        id: competingSessionId,
        timestamp: competingTimestampIso,
        cwd: competingSessionCwd
      }
    })}\n`,
    'utf8'
  );

  if (process.env.FAKE_CODEX_SKIP_SESSION_INDEX !== '1') {
    writeFileSync(
      sessionIndexPath,
      `${JSON.stringify({
        id: sessionId,
        thread_name: 'fake-thread',
        updated_at: primaryTimestampIso
      })}\n${JSON.stringify({
        id: competingSessionId,
        thread_name: 'competing-thread',
        updated_at: competingTimestampIso
      })}\n`,
      'utf8'
    );
  }
}

if (authText.includes('"account": "a"') || authText.includes('"account":"a"')) {
  if (process.env.FAKE_CODEX_WAIT_ON_QUOTA === '1') {
    process.stdout.write("■ You've hit your usage limit. To get more access now, send a request to your admin.\n");
    process.stdout.write('Approaching rate limits\n');
    process.stdout.write('Switch to gpt-5.1-codex-mini for lower credit usage?\n');
    setInterval(() => {}, 1000);
  } else {
    process.stdout.write("■ You've hit your usage limit. To get more access now, send a request to your admin.\n");
    process.stdout.write('or try again at 11:10 PM.\n');
    process.exit(1);
  }
}

if (args[0] === 'resume') {
  const resumeUsesLast = args.includes('--last');
  const positionalArgs = args.slice(1).filter((arg) => !arg.startsWith('--'));
  const sessionId = resumeUsesLast ? 'last' : positionalArgs[0] ?? '';
  const prompt = positionalArgs.at(-1) ?? '';

  if (process.env.FAKE_CODEX_FAIL_SESSION_ID === '1' && !resumeUsesLast) {
    process.stderr.write(`ERROR: No saved session found with ID ${sessionId}. Run \`codex resume\` without an ID to choose from existing sessions.\n`);
    process.exit(1);
  }

  if (process.env.FAKE_CODEX_RESUME_REPLAYS_OLD_QUOTA === '1') {
    process.stdout.write("■ You've hit your usage limit. To get more access now, send a request to your admin.\n");
    process.stdout.write('› \n');
    process.stdout.write('resumed prompt ready\n');
    process.exit(0);
  }

  process.stdout.write(`Resumed with ${sessionId} ${prompt}\n`);
  process.exit(0);
}

process.stdout.write('session started\n');
process.exit(0);
