import { assertSafeXml, DEFAULT_MAX_XML_BYTES, FseError } from '@massimiliano-dev/fse-core';
import { inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFSignature,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';

/**
 * Name of the embedded file the gateway looks for. Source: it-fse-support
 * `doc/integrazione-gateway/README.md` §2 ("il nome CDA allegato deve essere `cda.xml` (senza considerare
 * maiuscole e minuscole)") and it-fse-gtw-tools `pdf-generator/.../Launcher.java` (`fileName = "cda.xml"`,
 * `mimeType = "application/xml"`).
 */
export const CDA_ATTACHMENT_NAME = 'cda.xml';

/** MIME subtype of the embedded file, as set by it-fse-gtw-tools pdf-generator. */
export const CDA_ATTACHMENT_MIME_TYPE = 'application/xml';

/** Default maximum input PDF size: 20 MiB. */
export const DEFAULT_MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Options of {@link injectCda}. */
export interface InjectCdaOptions {
  /** Maximum CDA size in bytes. Default 10 MiB. */
  maxCdaBytes?: number;
  /** Maximum PDF size in bytes. Default 20 MiB. */
  maxPdfBytes?: number;
  /** Attachment creation/modification date. Default: now. */
  date?: Date;
}

/** Error raised for PDFs that cannot receive the CDA safely. Messages never contain document content. */
export class FsePdfError extends FseError {}

/**
 * Embeds a CDA2 document in a PDF as the `cda.xml` file attachment ("modalità ATTACHMENT"), the way
 * it-fse-gtw-tools pdf-generator does: an EmbeddedFiles name tree entry `cda.xml` with subtype
 * `application/xml`.
 *
 * The gateway looks for `cda.xml` at `Root/Names/EmbeddedFiles/Names/[1]/EF/F` or
 * `Root/Names/EmbeddedFiles/Kids/[0]/Names/[1]/EF/F` (README §2), i.e. it must be the **first** embedded
 * file. To guarantee it, PDFs that already have embedded files are refused.
 *
 * PDFs that are already signed are refused too: adding an attachment invalidates a PAdES signature. Inject
 * first, then sign (see {@link PadesSigner}).
 *
 * The CDA goes through the same input checks as the validator (no DOCTYPE/ENTITY, UTF-8, size limit).
 */
export async function injectCda(
  pdf: Uint8Array,
  cdaXml: string,
  options: InjectCdaOptions = {},
): Promise<Uint8Array> {
  const xml = assertSafeXml(cdaXml, { maxBytes: options.maxCdaBytes ?? DEFAULT_MAX_XML_BYTES });
  const maxPdf = options.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
  if (pdf.byteLength === 0 || pdf.byteLength > maxPdf) {
    throw new FsePdfError(`The PDF must be between 1 and ${maxPdf} bytes`);
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false, throwOnInvalidObject: true });
  } catch (error) {
    if ((error as Error).name === 'EncryptedPDFError')
      throw new FsePdfError('Encrypted PDFs are not supported');
    throw new FsePdfError('The input is not a readable PDF');
  }
  if (doc.isEncrypted) throw new FsePdfError('Encrypted PDFs are not supported');
  if (isSigned(doc)) {
    throw new FsePdfError('The PDF is already signed: inject the CDA before applying the PAdES signature');
  }
  if (hasEmbeddedFiles(doc)) {
    throw new FsePdfError('The PDF already has embedded files: cda.xml must be the only (first) attachment');
  }

  const date = options.date ?? new Date();
  await doc.attach(new TextEncoder().encode(xml), CDA_ATTACHMENT_NAME, {
    mimeType: CDA_ATTACHMENT_MIME_TYPE,
    description: 'CDA2',
    creationDate: date,
    modificationDate: date,
  });
  return doc.save({ useObjectStreams: false });
}

/**
 * Reads the `cda.xml` attachment from a PDF at the location the gateway uses
 * (`Root/Names/EmbeddedFiles/Names/[1]/EF/F`). Returns undefined if there is none.
 */
export async function extractCda(pdf: Uint8Array): Promise<string | undefined> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    throw new FsePdfError('The input is not a readable PDF');
  }
  const embeddedFiles = embeddedFilesTree(doc);
  if (!embeddedFiles) return undefined;
  const names = embeddedFiles.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!names || names.size() < 2) return undefined;

  const key = names.lookup(0);
  const keyText = key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : undefined;
  if (keyText?.toLowerCase() !== CDA_ATTACHMENT_NAME) return undefined;

  const spec = names.lookup(1, PDFDict);
  const ef = spec.lookup(PDFName.of('EF'), PDFDict);
  const stream = ef.lookup(PDFName.of('F'), PDFStream);
  if (!(stream instanceof PDFRawStream)) throw new FsePdfError('Unsupported cda.xml stream');
  const bytes = decodeStream(stream);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function decodeStream(stream: PDFRawStream): Uint8Array {
  try {
    return decodePDFRawStream(stream).decode();
  } catch {
    // Fallback for plain FlateDecode streams.
    return inflateSync(stream.asUint8Array());
  }
}

function embeddedFilesTree(doc: PDFDocument): PDFDict | undefined {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  return names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
}

function hasEmbeddedFiles(doc: PDFDocument): boolean {
  const tree = embeddedFilesTree(doc);
  if (!tree) return false;
  const names = tree.lookupMaybe(PDFName.of('Names'), PDFArray);
  const kids = tree.lookupMaybe(PDFName.of('Kids'), PDFArray);
  return (names?.size() ?? 0) > 0 || (kids?.size() ?? 0) > 0;
}

/**
 * True if the PDF has a signature field or `SigFlags` set (it does not verify the signature). Used to warn
 * before publishing a PDF that is not PAdES-signed (guide §2: "iniettato in PDF firmato digitalmente in
 * modalità PADES").
 */
export async function isPdfSigned(pdf: Uint8Array): Promise<boolean> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    throw new FsePdfError('The input is not a readable PDF');
  }
  return isSigned(doc);
}

function isSigned(doc: PDFDocument): boolean {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acroForm) return false;
  const sigFlags = acroForm.get(PDFName.of('SigFlags'));
  if (sigFlags && sigFlags.toString() !== '0') return true;
  return doc
    .getForm()
    .getFields()
    .some((field) => field instanceof PDFSignature);
}
