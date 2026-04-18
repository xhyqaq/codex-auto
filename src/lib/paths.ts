import { homedir } from 'node:os';
import path from 'node:path';

export function resolveAppHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_AUTO_HOME?.trim() || path.join(homedir(), '.codex-auto');
}

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME?.trim() || path.join(homedir(), '.codex');
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

export function instancesRoot(appHome: string): string {
  return path.join(appHome, 'instances');
}

export function instanceHome(appHome: string, instanceId: string): string {
  return path.join(instancesRoot(appHome), instanceId);
}

export function statePath(appHome: string): string {
  return path.join(appHome, 'state.json');
}

export function logsRoot(appHome: string): string {
  return path.join(appHome, 'logs');
}
