import type { CdaValidationIssue, CdaValidationResult, CdaValidator } from './types.js';

/**
 * Runs several validators in order (typically XSD then schematron) and merges their issues. Stops at the
 * first invalid result when `stopOnFirstInvalid` is true (default), as the gateway does.
 */
export class CompositeCdaValidator implements CdaValidator {
  constructor(
    private readonly validators: readonly CdaValidator[],
    private readonly options: { stopOnFirstInvalid?: boolean } = {},
  ) {}

  async validate(xml: string | Uint8Array): Promise<CdaValidationResult> {
    const issues: CdaValidationIssue[] = [];
    let valid = true;
    for (const validator of this.validators) {
      const result = await validator.validate(xml);
      issues.push(...result.issues);
      if (!result.valid) {
        valid = false;
        if (this.options.stopOnFirstInvalid !== false) break;
      }
    }
    return { valid, issues };
  }
}
