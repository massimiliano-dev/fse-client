import { FseError } from '@massimiliano-dev/fse-core';
import { memoryPages, validateXML, type XMLFileInfo, type XMLValidationResult } from 'xmllint-wasm';

/** Name under which the document is written in the WebAssembly in-memory file system. */
export const DOCUMENT_FILE_NAME = 'document.xml';

/** Default xmllint memory ceiling: 256 MiB. */
export const DEFAULT_MAX_MEMORY_PAGES = 256 * memoryPages.MiB;

/** A file given to xmllint. Names may contain `/` for sub-directories of the virtual file system. */
export interface XmlFile {
  fileName: string;
  contents: string;
}

/**
 * Runs the WebAssembly build of libxml2's xmllint. It executes in a worker thread with an in-memory file
 * system: it cannot read the host file system and `--nonet` forbids network access. Callers must have
 * passed the document through `assertSafeXml` first.
 */
export async function runXmllint(options: {
  xml: string;
  schema?: XmlFile;
  preload?: readonly XmlFile[];
  xpath?: string;
  maxMemoryPages?: number;
}): Promise<XMLValidationResult> {
  const preload: XMLFileInfo[] = [...(options.preload ?? [])];
  try {
    return await validateXML({
      xml: { fileName: DOCUMENT_FILE_NAME, contents: options.xml },
      schema: options.schema ? [options.schema] : [],
      preload,
      maxMemoryPages: options.maxMemoryPages ?? DEFAULT_MAX_MEMORY_PAGES,
      modifyArguments: (args) => {
        const base = ['--nonet', ...args];
        if (options.xpath === undefined) return base;
        // --xpath prints the result on stdout ("normalized"); --noout would suppress it.
        return ['--xpath', options.xpath, ...base.filter((arg) => arg !== '--noout')];
      },
    });
  } catch (error) {
    // Exit codes other than "valid"/"invalid" (schema errors, out of memory, empty XPath result…).
    // stderr may quote the document, so only a fixed message is kept.
    const code = (error as { code?: unknown }).code;
    throw new FseError(
      `xmllint could not process the document${typeof code === 'number' ? ` (exit code ${code})` : ''}`,
    );
  }
}
