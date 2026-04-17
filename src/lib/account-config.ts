import TOML from '@iarna/toml';
import { readTextIfExists, writeTextAtomic } from './fs.js';
import { accountConfigPath } from './paths.js';

export type TomlObject = Record<string, unknown>;

const minimumAccountConfig: TomlObject = {
  cli_auth_credentials_store: 'file'
};

function isPlainObject(value: unknown): value is TomlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeTomlObjects(base: TomlObject, override: TomlObject): TomlObject {
  const result: TomlObject = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = mergeTomlObjects(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function renderToml(document: TomlObject): string {
  return TOML.stringify(document as TOML.JsonMap).trimEnd() + '\n';
}

export async function ensureAccountConfig(appHome: string, accountName: string): Promise<TomlObject> {
  const filePath = accountConfigPath(appHome, accountName);
  const current = await readTextIfExists(filePath);

  if (!current) {
    await writeTextAtomic(filePath, renderToml(minimumAccountConfig));
    return { ...minimumAccountConfig };
  }

  const merged = mergeTomlObjects(minimumAccountConfig, TOML.parse(current) as TomlObject);
  await writeTextAtomic(filePath, renderToml(merged));
  return merged;
}

export async function buildRuntimeConfig(appHome: string, accountName: string): Promise<string> {
  const accountConfig = await ensureAccountConfig(appHome, accountName);
  return renderToml(mergeTomlObjects(minimumAccountConfig, accountConfig));
}
