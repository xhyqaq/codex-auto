import { homedir } from 'node:os';
import path from 'node:path';

export function resolveAppHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_AUTO_HOME?.trim() || path.join(homedir(), '.codex-auto');
}

export function accountsRoot(appHome: string): string {
  return path.join(appHome, 'accounts');
}

export function accountHome(appHome: string, name: string): string {
  return path.join(accountsRoot(appHome), name);
}

export function accountAuthPath(appHome: string, name: string): string {
  return path.join(accountHome(appHome, name), 'auth.json');
}

export function accountConfigPath(appHome: string, name: string): string {
  return path.join(accountHome(appHome, name), 'config.toml');
}

export function accountMetaPath(appHome: string, name: string): string {
  return path.join(accountHome(appHome, name), 'meta.json');
}

export function runtimeHome(appHome: string): string {
  return path.join(appHome, 'runtime');
}

export function runtimeAuthPath(appHome: string): string {
  return path.join(runtimeHome(appHome), 'auth.json');
}

export function runtimeConfigPath(appHome: string): string {
  return path.join(runtimeHome(appHome), 'config.toml');
}

export function runtimeSessionIndexPath(appHome: string): string {
  return path.join(runtimeHome(appHome), 'session_index.jsonl');
}

export function runtimeSessionsRoot(appHome: string): string {
  return path.join(runtimeHome(appHome), 'sessions');
}

export function runtimeLockPath(appHome: string): string {
  return path.join(runtimeHome(appHome), '.lock');
}

export function statePath(appHome: string): string {
  return path.join(appHome, 'state.json');
}

export function logsRoot(appHome: string): string {
  return path.join(appHome, 'logs');
}
