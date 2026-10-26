import { assertSafeXml, DEFAULT_MAX_XML_BYTES, redact } from '@massimiliano-dev/fse-core';
import type { CdaValidationIssue, CdaValidationResult, CdaValidator } from './types.js';
import { DOCUMENT_FILE_NAME, runXmllint, type XmlFile } from './xmllint.js';

/** A set of XSD files: the entry schema plus everything it includes or imports. */
export interface XsdSchemaSet {
  /** The schema passed to xmllint (`--schema`). */
  entry: XmlFile;
  /** Included/imported schemas, with the relative paths used in `schemaLocation`. */
  includes: readonly XmlFile[];
}

/** Options of {@link XsdValidator}. */
export interface XsdValidatorOptions {
  /** Maximum document size in bytes. Default 10 MiB. */
  maxInputBytes?: number;
  /** xmllint memory ceiling in 64 KiB WebAssembly pages. Default 256 MiB. */
  maxMemoryPages?: number;
  /** Maximum number of issues returned. Default 100. */
  maxIssues?: number;
}

/**
 * XSD validation with libxml2 compiled to WebAssembly (`xmllint-wasm`): no native compilation, no access to
 * the host file system, no network.
 *
 * Input hardening (see `assertSafeXml`): DOCTYPE/ENTITY declarations are refused before parsing (XXE and
 * entity bombs), only UTF-8 is accepted, size is capped (default 10 MiB). Issue messages are redacted
 * because libxml2 quotes invalid values, which can be personal data.
 */
export class XsdValidator implements CdaValidator {
  readonly #schema: XsdSchemaSet;
  readonly #maxInputBytes: number;
  readonly #maxMemoryPages: number | undefined;
  readonly #maxIssues: number;

  constructor(schema: XsdSchemaSet, options: XsdValidatorOptions = {}) {
    for (const file of [schema.entry, ...schema.includes]) {
      if (!/^[\w.-]+(\/[\w.-]+)*$/.test(file.fileName) || file.fileName.split('/').includes('..')) {
        throw new TypeError('Schema file names must be relative paths without ".."');
      }
      if (file.fileName === DOCUMENT_FILE_NAME) throw new TypeError(`"${DOCUMENT_FILE_NAME}" is reserved`);
    }
    this.#schema = schema;
    this.#maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_XML_BYTES;
    this.#maxMemoryPages = options.maxMemoryPages;
    this.#maxIssues = options.maxIssues ?? 100;
  }

  /**
   * Validates the document against the schema.
   *
   * @throws {UnsafeXmlError} if the input is refused before parsing.
   */
  async validate(xml: string | Uint8Array): Promise<CdaValidationResult> {
    const text = assertSafeXml(xml, { maxBytes: this.#maxInputBytes });
    const result = await runXmllint({
      xml: text,
      schema: this.#schema.entry,
      preload: this.#schema.includes,
      ...(this.#maxMemoryPages === undefined ? {} : { maxMemoryPages: this.#maxMemoryPages }),
    });
    const issues: CdaValidationIssue[] = result.valid
      ? []
      : documentMessages(result.rawOutput)
          .slice(0, this.#maxIssues)
          .map(({ line, message }) => ({
            severity: 'error' as const,
            source: 'xsd' as const,
            message,
            line,
          }));
    if (!result.valid && issues.length === 0) {
      issues.push({ severity: 'error', source: 'xsd', message: 'Document is not valid against the XSD' });
    }
    return { valid: result.valid, issues };
  }
}

const DOCUMENT_LINE = new RegExp(`^${DOCUMENT_FILE_NAME.replace('.', '\\.')}:(\\d+): (.*)$`);

/**
 * Extracts the messages about the validated document from xmllint's stderr.
 *
 * Only lines of the form `document.xml:<line>: <message>` are kept. Everything else is dropped on purpose:
 * for well-formedness errors libxml2 also prints the offending **source line** of the document and a caret
 * line, which would leak document content; schema-parser warnings are about the XSD, not the document.
 */
export function documentMessages(rawOutput: string): { line: number; message: string }[] {
  const out: { line: number; message: string }[] = [];
  for (const raw of rawOutput.split('\n')) {
    const match = DOCUMENT_LINE.exec(raw);
    if (!match) continue;
    const message =
      match[2]?.replace(/^(?:Schemas validity error|parser error|namespace error)\s*:\s*/, '') ?? '';
    out.push({ line: Number(match[1]), message: maskQuotedValues(message) });
  }
  return out;
}

/**
 * libxml2 quotes the offending **values** in schema errors (`'Mario' is not a valid value…`,
 * `The value 'Mario' is not accepted…`). Values can be personal data, so they are masked; element and
 * attribute names (`Element '{urn:hl7-org:v3}family'`) are kept because they locate the problem.
 * The result also goes through `redact()`.
 */
export function maskQuotedValues(message: string): string {
  return redact(
    message
      .replace(/'[^']*'(?=\s+is not (?:a valid value|accepted|an element|facet-valid))/g, "'[VALUE]'")
      .replace(/\b([Vv]alue)\s+'[^']*'/g, "$1 '[VALUE]'")
      .replace(/(attribute '[^']*': )'[^']*'/g, "$1'[VALUE]'"),
  );
}
