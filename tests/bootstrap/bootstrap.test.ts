import path from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('project bootstrap', () => {
  test('package metadata exists', () => {
    expect(existsSync(path.resolve(process.cwd(), 'package.json'))).toBe(true);
  });
});
