/** Severity of a validation issue. */
export type CdaIssueSeverity = 'error' | 'warning';

/** Which check produced the issue. */
export type CdaIssueSource = 'xsd' | 'schematron';

/** One validation problem. `message` is redacted: values copied from the document are masked. */
export interface CdaValidationIssue {
  severity: CdaIssueSeverity;
  source: CdaIssueSource;
  message: string;
  /** Line in the validated document, when known. */
  line?: number;
  /** XPath location reported by Schematron (SVRL `@location`), when known. */
  location?: string;
}

/** Outcome of a validation. `valid` is false when at least one issue has severity `error`. */
export interface CdaValidationResult {
  valid: boolean;
  issues: readonly CdaValidationIssue[];
}

/**
 * Validates a CDA2 document. Implementations must reject unsafe XML before parsing it (see
 * `assertSafeXml` in `@massimiliano-dev/fse-core`) and must not put document content into messages
 * without redaction.
 */
export interface CdaValidator {
  validate(xml: string | Uint8Array): Promise<CdaValidationResult>;
}
