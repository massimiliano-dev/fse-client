import { assertSafeXml } from '@massimiliano-dev/fse-core';
import { summarizePreparedRequest, type ValidationActivity } from '@massimiliano-dev/fse-gateway-client';
import { injectCda } from '@massimiliano-dev/fse-pdf';
import { CliError, readLimitedFile } from '../files.js';
import {
  checkEnvironment,
  claimsFromCda,
  contextFor,
  documentFromPdf,
  MAX_PDF_BYTES,
  openGateway,
  printDryRun,
  printResult,
  withClient,
  type GatewayCommandOptions,
} from '../gateway.js';
import { ExitCode, type CliIo } from '../io.js';
import { maxXmlBytes, resolveXsdValidator, type LocalValidationOptions } from '../validators.js';
import { printResult as printLocalResult } from './validate.js';

/** Options of `fse validate --gateway` and `fse send`. */
export interface GatewayValidateOptions extends LocalValidationOptions, GatewayCommandOptions {
  /** PDF to inject the CDA into, when the input is an XML file. */
  pdf?: string;
  activity?: string;
  /** Commander negated flag `--no-local-validation`. */
  localValidation?: boolean;
}

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

/**
 * Gateway validation (`POST /documents/validation`). `file` is either a CDA (XML, then `--pdf` gives the
 * PDF to inject it into) or a PDF that already contains `cda.xml`. The CDA is validated locally against the
 * XSD first (unless `--no-local-validation`); `person_id` and `resource_hl7_type` are read from the CDA.
 */
export async function gatewayValidateCommand(
  io: CliIo,
  file: string,
  options: GatewayValidateOptions,
): Promise<number> {
  const env = checkEnvironment(io, options);
  const activity = (options.activity ?? 'VERIFICA') as ValidationActivity;
  if (activity !== 'VERIFICA' && activity !== 'VALIDATION') {
    throw new CliError('--activity must be VERIFICA or VALIDATION');
  }
  const maxXml = maxXmlBytes(options);
  const input = await readLimitedFile(io.cwd, file, Math.max(maxXml, MAX_PDF_BYTES), 'Input file');
  let cda: string;
  let pdf: Uint8Array;
  if (input.subarray(0, 5).equals(PDF_MAGIC)) {
    ({ cda, pdf } = await documentFromPdf(new Uint8Array(input), maxXml));
  } else {
    cda = assertSafeXml(input, { maxBytes: maxXml });
    if (!options.pdf)
      throw new CliError('--pdf <file.pdf> is required to inject a CDA (or pass a prepared PDF)');
    const base = await readLimitedFile(io.cwd, options.pdf, MAX_PDF_BYTES, 'PDF file');
    pdf = await injectCda(new Uint8Array(base), cda);
  }

  if (options.localValidation !== false) {
    const validator = await resolveXsdValidator(io, options);
    const result = await validator.validate(cda);
    if (!result.valid) {
      printLocalResult(io, file, result, options.json === true);
      io.stderr('Local XSD validation failed: nothing sent to the gateway.\n');
      return ExitCode.invalid;
    }
  }

  const claims = await claimsFromCda(cda);
  const { client, contextFile } = await openGateway(io, env, options.context);
  const request = { pdf, requestBody: { activity }, context: contextFor(contextFile, claims) };
  return withClient(io, client, options.json, async () => {
    if (options.dryRun) {
      printDryRun(io, env, summarizePreparedRequest(await client.prepareValidation(request)));
      return ExitCode.ok;
    }
    const result = await client.validate(request);
    printResult(
      io,
      options.json,
      { ok: true, operation: 'validate', ...result },
      [
        `VALID (gateway, HTTP ${result.httpStatus}, ${activity})`,
        result.workflowInstanceId ? `workflowInstanceId: ${result.workflowInstanceId}` : undefined,
        result.traceID ? `traceID: ${result.traceID}` : undefined,
        result.warning ? `warning: ${result.warning}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return ExitCode.ok;
  });
}
