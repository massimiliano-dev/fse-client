import { makeTestPdf, readSyntheticCda } from '@massimiliano-dev/fse-fixtures';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { UnsafeXmlError } from '@massimiliano-dev/fse-core';
import { CDA_ATTACHMENT_NAME, extractCda, FsePdfError, injectCda } from '../src/index.js';

describe('injectCda', () => {
  it('embeds the CDA as cda.xml at Root/Names/EmbeddedFiles/Names/[1]/EF/F', async () => {
    const cda = readSyntheticCda();
    const out = await injectCda(makeTestPdf(), cda, { date: new Date('2026-01-01T00:00:00Z') });
    expect(Buffer.from(out.subarray(0, 5)).toString('latin1')).toBe('%PDF-');

    const doc = await PDFDocument.load(out);
    const names = doc.catalog
      .lookup(PDFName.of('Names'), PDFDict)
      .lookup(PDFName.of('EmbeddedFiles'), PDFDict)
      .lookup(PDFName.of('Names'), PDFArray);
    expect(names.size()).toBe(2);
    // pdf-lib writes the key as a hex string; both string forms are valid name-tree keys.
    expect(names.lookup(0, PDFString, PDFHexString).decodeText()).toBe(CDA_ATTACHMENT_NAME);
    const spec = names.lookup(1, PDFDict);
    const ef = spec.lookup(PDFName.of('EF'), PDFDict);
    expect(ef.get(PDFName.of('F'))).toBeDefined();

    expect(await extractCda(out)).toBe(cda);
  });

  it('declares application/xml as subtype, like it-fse-gtw-tools', async () => {
    const out = await injectCda(makeTestPdf(), readSyntheticCda());
    expect(Buffer.from(out).toString('latin1')).toMatch(/\/Subtype \/application#2Fxml/);
  });

  it('refuses PDFs that already have attachments, so cda.xml is always the first one', async () => {
    const once = await injectCda(makeTestPdf(), readSyntheticCda());
    await expect(injectCda(once, readSyntheticCda())).rejects.toBeInstanceOf(FsePdfError);
  });

  it('refuses inputs that are not PDFs and unsafe CDA documents', async () => {
    await expect(injectCda(new TextEncoder().encode('not a pdf'), readSyntheticCda())).rejects.toBeInstanceOf(
      FsePdfError,
    );
    await expect(injectCda(makeTestPdf(), '<!DOCTYPE x [<!ENTITY y "z">]><x>&y;</x>')).rejects.toBeInstanceOf(
      UnsafeXmlError,
    );
    await expect(injectCda(new Uint8Array(0), readSyntheticCda())).rejects.toBeInstanceOf(FsePdfError);
  });

  it('returns undefined when a PDF has no CDA', async () => {
    await expect(extractCda(makeTestPdf())).resolves.toBeUndefined();
  });
});
