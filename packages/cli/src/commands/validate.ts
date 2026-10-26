import type { CdaValidationResult } from '@massimiliano-dev/fse-validator';
import { readLimitedFile } from '../files.js';
import { ExitCode, type CliIo } from '../io.js';
import { maxXmlBytes, resolveXsdValidator, type LocalValidationOptions } from '../validators.js';

/** Options of `fse validate`. */
export interface ValidateCommandOptions extends LocalValidationOptions {
  json?: boolean;
}

/** `fse validate <file.xml>`: XSD validation. Exit 0 valid, 1 invalid. Prints only redacted issues. */
export async function validateCommand(
  io: CliIo,
  file: string,
  options: ValidateCommandOptions,
): Promise<number> {
  const validator = await resolveXsdValidator(io, options);
  const xml = await readLimitedFile(io.cwd, file, maxXmlBytes(options), 'XML file');
  const result = await validator.validate(xml);
  printResult(io, file, result, options.json === true);
  return result.valid ? ExitCode.ok : ExitCode.invalid;
}

/** Prints a validation result (never the document). */
export function printResult(io: CliIo, file: string, result: CdaValidationResult, json: boolean): void {
  if (json) {
    io.stdout(`${JSON.stringify({ file, valid: result.valid, issues: result.issues }, null, 2)}\n`);
    return;
  }
  io.stdout(`${result.valid ? 'VALID' : 'INVALID'}: ${file} (${result.issues.length} issue(s))\n`);
  for (const issue of result.issues) {
    const where = issue.line === undefined ? '' : `line ${issue.line}: `;
    io.stdout(`  [${issue.source} ${issue.severity}] ${where}${issue.message}\n`);
  }
}
