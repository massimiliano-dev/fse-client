import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_XML_INVALID, TEST_XML_VALID, TEST_XSD } from '@massimiliano-dev/fse-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';
import { captureIo } from './helpers.js';

let dir: string;
const REAL_LOOKING_CF = ['RSSMRA', '85T10A562S'].join('');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fse-cli-validate-'));
  await writeFile(join(dir, 'schema.xsd'), TEST_XSD);
  await writeFile(join(dir, 'valid.xml'), TEST_XML_VALID);
  await writeFile(join(dir, 'invalid.xml'), TEST_XML_INVALID);
  await writeFile(
    join(dir, 'phi.xml'),
    `<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="1"/><title>t</title><count>${REAL_LOOKING_CF}</count></ClinicalDocument>`,
  );
  await writeFile(join(dir, 'xxe.xml'), '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>');
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('fse validate', () => {
  it('exits 0 for a valid document', async () => {
    const io = captureIo(dir);
    expect(await runCli(['validate', 'valid.xml', '--schema', 'schema.xsd'], io)).toBe(0);
    expect(io.out).toBe('VALID: valid.xml (0 issue(s))\n');
  });

  it('exits 1 and prints the errors for an invalid document', async () => {
    const io = captureIo(dir);
    expect(await runCli(['validate', 'invalid.xml', '--schema', 'schema.xsd'], io)).toBe(1);
    expect(io.out).toMatch(/^INVALID: invalid\.xml/);
    expect(io.out).toMatch(/\[xsd error\] line 2: .*unexpected/);
  });

  it('never prints personal data quoted from the document', async () => {
    const io = captureIo(dir);
    expect(await runCli(['validate', 'phi.xml', '--schema', 'schema.xsd', '--json'], io)).toBe(1);
    expect(io.out).not.toContain(REAL_LOOKING_CF);
    expect(JSON.parse(io.out)).toMatchObject({ valid: false });
  });

  it('exits 1 for an XXE payload without parsing it', async () => {
    const io = captureIo(dir);
    expect(await runCli(['validate', 'xxe.xml', '--schema', 'schema.xsd'], io)).toBe(1);
    expect(io.err).toMatch(/DOCTYPE/);
  });

  it('exits 2 with a hint when the catalogs are missing', async () => {
    const io = captureIo(dir);
    expect(await runCli(['validate', 'valid.xml', '--catalogs', 'missing'], io)).toBe(2);
    expect(io.err).toMatch(/pnpm sync:catalogs/);
  });
});
