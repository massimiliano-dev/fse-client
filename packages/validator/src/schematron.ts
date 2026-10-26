import {
  assertSafeXml,
  DEFAULT_MAX_XML_BYTES,
  OptionalDependencyMissingError,
  redact,
} from '@massimiliano-dev/fse-core';
import type { CdaValidationIssue, CdaValidationResult, CdaValidator } from './types.js';

/**
 * Schematron validation of a CDA2 document against one of the FSE schematron files
 * (it-fse-catalogs `schematron/*.sch`, `queryBinding="xslt2"`).
 */
export interface SchematronValidator extends CdaValidator {
  /** Name of the schematron, e.g. `schematron_RSA_v8.3`. */
  readonly schematronName: string;
}

/** The subset of the SaxonJS 2 API used here. SaxonJS ships no TypeScript types. */
export interface SaxonJsLike {
  transform(options: Record<string, unknown>, mode: 'async'): Promise<{ principalResult: unknown }>;
  getResource(options: { text: string; type: 'xml' }): Promise<unknown>;
  XPath: { evaluate(expression: string, context: unknown, options?: Record<string, unknown>): unknown };
}

/** Options of {@link SaxonSchematronValidator}. */
export interface SaxonSchematronOptions {
  /** Name used in messages, e.g. `schematron_RSA_v8.3`. */
  schematronName: string;
  /**
   * The schematron compiled to an XSLT and then to a SaxonJS SEF (JSON), for example with SchXslt and
   * `xslt3 -xsl:compiled.xsl -export:rsa.sef.json -nogo`. TODO(verify): compile pipeline for the FSE
   * schematrons and the `xslt3` licence for build-time use.
   */
  sef: string;
  /** Maximum document size in bytes. Default 10 MiB. */
  maxInputBytes?: number;
  /** Loader for SaxonJS (tests). Default: dynamic `import('saxon-js')`. */
  loadSaxon?: () => Promise<SaxonJsLike>;
}

async function importSaxon(): Promise<SaxonJsLike> {
  // Variable specifier: saxon-js is an optional peer dependency and must not be resolved at build time.
  const specifier = 'saxon-js';
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as { default?: SaxonJsLike } & SaxonJsLike;
    return mod.default ?? mod;
  } catch {
    throw new OptionalDependencyMissingError('saxon-js', 'Schematron validation');
  }
}

/**
 * Schematron validator running a precompiled schematron with SaxonJS, loaded lazily from the optional
 * peer dependency `saxon-js` (proprietary Saxonica licence, see README). The document goes through the
 * same input hardening as the XSD validator first.
 *
 * Status: implemented but not yet tested against the FSE schematrons. TODO(verify).
 */
export class SaxonSchematronValidator implements SchematronValidator {
  readonly schematronName: string;
  readonly #sef: string;
  readonly #maxInputBytes: number;
  readonly #loadSaxon: () => Promise<SaxonJsLike>;
  #saxon: Promise<SaxonJsLike> | undefined;

  constructor(options: SaxonSchematronOptions) {
    this.schematronName = options.schematronName;
    this.#sef = options.sef;
    this.#maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_XML_BYTES;
    this.#loadSaxon = options.loadSaxon ?? importSaxon;
  }

  async validate(xml: string | Uint8Array): Promise<CdaValidationResult> {
    const text = assertSafeXml(xml, { maxBytes: this.#maxInputBytes });
    this.#saxon ??= this.#loadSaxon();
    const saxon = await this.#saxon;

    const { principalResult } = await saxon.transform(
      { stylesheetText: this.#sef, sourceText: text, destination: 'serialized' },
      'async',
    );
    if (typeof principalResult !== 'string')
      throw new TypeError('Unexpected SaxonJS result (expected SVRL text)');
    const svrl = await saxon.getResource({ text: principalResult, type: 'xml' });
    const nodes = saxon.XPath.evaluate(
      "//*[local-name()='failed-assert' or local-name()='successful-report']",
      svrl,
      { resultForm: 'array' },
    ) as unknown[];

    const issues: CdaValidationIssue[] = nodes.map((node) => {
      const message = String(saxon.XPath.evaluate("normalize-space(*[local-name()='text'])", node));
      const location = String(saxon.XPath.evaluate('string(@location)', node));
      // FSE schematrons prefix messages with "ERRORE-n|" or "W…|" (no @role). TODO(verify) for all files.
      const severity = /^\s*W[\w-]*\|/.test(message) ? ('warning' as const) : ('error' as const);
      return {
        severity,
        source: 'schematron' as const,
        message: redact(message),
        ...(location ? { location } : {}),
      };
    });
    return { valid: !issues.some((i) => i.severity === 'error'), issues };
  }
}
