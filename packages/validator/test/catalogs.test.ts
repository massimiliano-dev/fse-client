import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSyntheticCda, readSyntheticLabCda } from '@massimiliano-dev/fse-fixtures';
import { describe, expect, it } from 'vitest';
import {
  bundledCatalogsDir,
  bundledSchematronSefDir,
  CATALOGS_COMMIT_MARKER,
  createFseXsdValidator,
  FSE_CATALOGS_COMMIT,
  loadFseCdaSchema,
  SaxonSchematronValidator,
} from '../src/index.js';

const scriptPath = fileURLToPath(new URL('../scripts/sync-catalogs.ts', import.meta.url));
const bundleScriptPath = fileURLToPath(new URL('../scripts/bundle-catalogs.ts', import.meta.url));
const vendorDir = fileURLToPath(new URL('../../../vendor/it-fse-catalogs', import.meta.url));

describe('it-fse-catalogs pin', () => {
  it('uses the same commit in the library and in the sync script', () => {
    for (const path of [scriptPath, bundleScriptPath]) {
      expect(readFileSync(path, 'utf8')).toContain(`const FSE_CATALOGS_COMMIT = '${FSE_CATALOGS_COMMIT}';`);
    }
    expect(FSE_CATALOGS_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  it('explains how to get the catalogs when they are missing', async () => {
    await expect(loadFseCdaSchema('/nonexistent/it-fse-catalogs')).rejects.toThrow(/pnpm sync:catalogs/);
  });

  it('resolves the bundled folders inside the package, next to src/ and dist/', () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    expect(bundledCatalogsDir()).toBe(join(packageRoot, 'catalogs', 'it-fse-catalogs'));
    expect(bundledSchematronSefDir()).toBe(join(packageRoot, 'catalogs', 'schematron-sef'));
  });
});

// The bundle is copied from vendor/ by `pnpm build` (scripts/bundle-catalogs.ts); `prepack` refuses to
// pack the package without it. Skipped in a fresh clone that never ran sync:catalogs + compile:schematron.
describe.skipIf(!existsSync(join(bundledCatalogsDir(), CATALOGS_COMMIT_MARKER)))(
  'catalogs bundled in the package',
  () => {
    it('loads the CDA2 schema without any folder and validates a document', async () => {
      const loaded = await loadFseCdaSchema();
      expect(loaded.commit).toBe(FSE_CATALOGS_COMMIT);
      expect(loaded.schema.entry.fileName).toBe('CDA.xsd');

      const validator = await createFseXsdValidator();
      await expect(validator.validate(readSyntheticCda())).resolves.toEqual({ valid: true, issues: [] });
      const broken = readSyntheticCda().replace(/<recordTarget>[\s\S]*<\/recordTarget>/, '');
      expect((await validator.validate(broken)).valid).toBe(false);
    });

    it('passes options with the bundled catalogs', async () => {
      const validator = await createFseXsdValidator(undefined, { variant: 'POCD_MT000040UV02' });
      await expect(validator.validate(readSyntheticCda())).resolves.toMatchObject({ valid: true });
    });

    it('ships the compiled LAB schematron', async () => {
      const sef = readFileSync(join(bundledSchematronSefDir(), 'schematronFSE_LAB_v27.1.sef.json'), 'utf8');
      const validator = new SaxonSchematronValidator({ schematronName: 'schematronFSE_LAB_v27.1', sef });
      await expect(validator.validate(readSyntheticLabCda())).resolves.toEqual({ valid: true, issues: [] });
    });

    it('still checks the commit marker of an external checkout', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fse-catalogs-'));
      try {
        await cp(join(bundledCatalogsDir(), 'schema'), join(dir, 'schema'), { recursive: true });
        await writeFile(join(dir, CATALOGS_COMMIT_MARKER), `${'0'.repeat(40)}\n`);
        await expect(loadFseCdaSchema(dir)).rejects.toThrow(`expected ${FSE_CATALOGS_COMMIT}`);
        await expect(loadFseCdaSchema(dir, { allowOtherCommit: true })).resolves.toMatchObject({
          commit: '0'.repeat(40),
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  },
);

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
