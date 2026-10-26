import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSyntheticCda, readSyntheticLabCda } from '@massimiliano-dev/fse-fixtures';
import { describe, expect, it } from 'vitest';
import { SaxonSchematronValidator } from '../src/index.js';

/**
 * Runs the OFFICIAL LAB schematron (it-fse-catalogs, pinned commit) compiled with SchXslt + xslt3 by
 * `pnpm sync:catalogs && pnpm compile:schematron`. Skipped when the compiled SEF is not there (fresh clone
 * without the vendor/ folder); CI runs it in the "official-xsd" job.
 */
const SEF = fileURLToPath(
  new URL('../../../vendor/schematron-sef/schematronFSE_LAB_v27.1.sef.json', import.meta.url),
);
const compiled = existsSync(SEF);

describe.skipIf(!compiled)('official LAB schematron (schematronFSE_LAB_v27.1) with SaxonJS', () => {
  const validator = () =>
    new SaxonSchematronValidator({
      schematronName: 'schematronFSE_LAB_v27.1',
      sef: readFileSync(SEF, 'utf8'),
    });

  it('accepts the synthetic laboratory report', async () => {
    const result = await validator().validate(readSyntheticLabCda());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('reports ERRORE-1 and ERRORE-2 when realmCode is missing', async () => {
    const broken = readSyntheticLabCda().replace('<realmCode code="IT"/>', '');
    const result = await validator().validate(broken);
    expect(result.valid).toBe(false);
    const codes = result.issues.map((i) => /^([A-Z]+-\d+)\|/.exec(i.message)?.[1]);
    expect(codes).toEqual(expect.arrayContaining(['ERRORE-1', 'ERRORE-2']));
    expect(result.issues.every((i) => i.source === 'schematron' && i.severity === 'error')).toBe(true);
    expect(result.issues[0]?.location).toMatch(/ClinicalDocument/);
  });

  it('reports ERRORE-5 for a document that is not a laboratory report', async () => {
    const result = await validator().validate(readSyntheticCda());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.startsWith('ERRORE-5|'))).toBe(true);
  });

  it('treats W… reports as warnings, which do not make the document invalid', async () => {
    const result = await validator().validate(
      readSyntheticLabCda().replace('displayName="Referto di laboratorio"', 'displayName="Altro"'),
    );
    expect(result.valid).toBe(true);
    expect(result.issues.map((i) => [i.severity, i.message.slice(0, 5)])).toEqual([['warning', 'W001|']]);
  });

  it('redacts fiscal codes quoted by the schematron messages', async () => {
    const realLooking = ['RSSMRA', '85T10A562S'].join('');
    const result = await validator().validate(
      readSyntheticLabCda().replace('extension="PROVAX00X00X000Y"', `extension="${realLooking}x"`),
    );
    // ERRORE-46 quotes the offending value: "codice fiscale '<value-of select="$CF"/>' …".
    expect(result.issues.some((i) => i.message.startsWith('ERRORE-46|'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(realLooking);
  });
});
