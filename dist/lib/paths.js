import { homedir } from 'node:os';
import path from 'node:path';
export function resolveAppHome(env = process.env) {
    return env.CODEX_AUTO_HOME?.trim() || path.join(homedir(), '.codex-auto');
}
export function accountsRoot(appHome) {
    return path.join(appHome, 'accounts');
}
export function accountHome(appHome, name) {
    return path.join(accountsRoot(appHome), name);
}
export function accountAuthPath(appHome, name) {
    return path.join(accountHome(appHome, name), 'auth.json');
}
export function accountConfigPath(appHome, name) {
    return path.join(accountHome(appHome, name), 'config.toml');
}
export function accountMetaPath(appHome, name) {
    return path.join(accountHome(appHome, name), 'meta.json');
}
export function runtimeHome(appHome) {
    return path.join(appHome, 'runtime');
}
export function runtimeAuthPath(appHome) {
    return path.join(runtimeHome(appHome), 'auth.json');
}
export function runtimeConfigPath(appHome) {
    return path.join(runtimeHome(appHome), 'config.toml');
}
export function runtimeLockPath(appHome) {
    return path.join(runtimeHome(appHome), '.lock');
}
export function statePath(appHome) {
    return path.join(appHome, 'state.json');
}
export function logsRoot(appHome) {
    return path.join(appHome, 'logs');
}
