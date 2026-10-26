import { readSyntheticCda, SYNTHETIC_FISCAL_CODE } from '@massimiliano-dev/fse-fixtures';
import { describe, expect, it } from 'vitest';
import { extractCdaHeader, UnsafeXmlError } from '../src/index.js';

describe('extractCdaHeader', () => {
  it('reads the patient fiscal code and the document type', async () => {
    await expect(extractCdaHeader(readSyntheticCda())).resolves.toEqual({
      patientFiscalCode: SYNTHETIC_FISCAL_CODE,
      documentTypeCode: '11488-4',
      documentTypeCodeSystem: '2.16.840.1.113883.6.1',
    });
  });

  it('returns undefined fields for a document without header', async () => {
    await expect(extractCdaHeader('<ClinicalDocument xmlns="urn:hl7-org:v3"/>')).resolves.toEqual({
      patientFiscalCode: undefined,
      documentTypeCode: undefined,
      documentTypeCodeSystem: undefined,
    });
  });

  it('uses the hardened input checks', async () => {
    await expect(extractCdaHeader('<!DOCTYPE x><x/>')).rejects.toBeInstanceOf(UnsafeXmlError);
  });
});
