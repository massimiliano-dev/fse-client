import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSyntheticCda } from '@massimiliano-dev/fse-fixtures';
import { describe, expect, it } from 'vitest';
import { createFseXsdValidator, FSE_CATALOGS_COMMIT, loadFseCdaSchema } from '../src/index.js';

const scriptPath = fileURLToPath(new URL('../scripts/sync-catalogs.ts', import.meta.url));
const vendorDir = fileURLToPath(new URL('../../../vendor/it-fse-catalogs', import.meta.url));

describe('it-fse-catalogs pin', () => {
  it('uses the same commit in the library and in the sync script', () => {
    expect(readFileSync(scriptPath, 'utf8')).toContain(
      `const FSE_CATALOGS_COMMIT = '${FSE_CATALOGS_COMMIT}';`,
    );
    expect(FSE_CATALOGS_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  it('explains how to get the catalogs when they are missing', async () => {
    await expect(loadFseCdaSchema('/nonexistent/it-fse-catalogs')).rejects.toThrow(/pnpm sync:catalogs/);
  });
});

// Runs only after `pnpm sync:catalogs` (the catalogs are not committed and not downloaded in CI).
describe.skipIf(!existsSync(vendorDir))('official CDA2 XSD (vendor/it-fse-catalogs)', () => {
  it('validates the synthetic CDA fixture', async () => {
    const validator = await createFseXsdValidator(vendorDir);
    await expect(validator.validate(readSyntheticCda())).resolves.toEqual({ valid: true, issues: [] });
  });

  it('rejects a CDA without its mandatory header', async () => {
    const validator = await createFseXsdValidator(vendorDir);
    const broken = readSyntheticCda().replace(/<recordTarget>[\s\S]*<\/recordTarget>/, '');
    const result = await validator.validate(broken);
    expect(result.valid).toBe(false);
  });
});
