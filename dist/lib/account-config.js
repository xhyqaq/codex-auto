import TOML from '@iarna/toml';
import { readTextIfExists, writeTextAtomic } from './fs.js';
import { accountConfigPath } from './paths.js';
const minimumAccountConfig = {
    cli_auth_credentials_store: 'file'
};
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function mergeTomlObjects(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const existing = result[key];
        if (isPlainObject(existing) && isPlainObject(value)) {
            result[key] = mergeTomlObjects(existing, value);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
export function renderToml(document) {
    return TOML.stringify(document).trimEnd() + '\n';
}
export async function ensureAccountConfig(appHome, accountName) {
    const filePath = accountConfigPath(appHome, accountName);
    const current = await readTextIfExists(filePath);
    if (!current) {
        await writeTextAtomic(filePath, renderToml(minimumAccountConfig));
        return { ...minimumAccountConfig };
    }
    const merged = mergeTomlObjects(minimumAccountConfig, TOML.parse(current));
    await writeTextAtomic(filePath, renderToml(merged));
    return merged;
}
export async function buildRuntimeConfig(appHome, accountName) {
    const accountConfig = await ensureAccountConfig(appHome, accountName);
    return renderToml(mergeTomlObjects(minimumAccountConfig, accountConfig));
}
