import { assertSafeXml } from '@massimiliano-dev/fse-core';
import {
  FSE_ENVIRONMENTS,
  isFseEnvironment,
  prepareValidationRequest,
  summarizePreparedRequest,
  type ValidationActivity,
} from '@massimiliano-dev/fse-gateway-client';
import { injectCda } from '@massimiliano-dev/fse-pdf';
import { CODICE_FISCALE_OID, extractCdaHeader } from '@massimiliano-dev/fse-validator';
import { buildRequestContext, loadContextFile } from '../context.js';
import { loadSigner, loadTls } from '../credentials.js';
import { CliError, readLimitedFile } from '../files.js';
import { ExitCode, type CliIo } from '../io.js';
import { maxXmlBytes, resolveXsdValidator, type LocalValidationOptions } from '../validators.js';
import { printResult } from './validate.js';

/** Options of `fse send`. */
export interface SendCommandOptions extends LocalValidationOptions {
  env: string;
  dryRun?: boolean;
  activity?: string;
  context?: string;
  /** Commander negated flag `--no-local-validation`. */
  localValidation?: boolean;
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * `fse send <cda.xml> <pdf> --env pre --dry-run`: validates the CDA locally, injects it into the PDF,
 * builds the signed gateway validation request and prints a redacted summary. Nothing is sent.
 * Real sending from the CLI is not implemented yet.
 */
export async function sendCommand(
  io: CliIo,
  cdaPath: string,
  pdfPath: string,
  options: SendCommandOptions,
): Promise<number> {
  if (!isFseEnvironment(options.env)) throw new CliError('--env must be "pre" or "prod"');
  const activity = (options.activity ?? 'VERIFICA') as ValidationActivity;
  if (activity !== 'VERIFICA' && activity !== 'VALIDATION')
    throw new CliError('--activity must be VERIFICA or VALIDATION');
  if (options.env === 'prod') {
    io.stderr(
      'warning: --env prod targets the PRODUCTION gateway with real patients. Use "pre" for tests.\n',
    );
  }
  if (!options.dryRun) {
    throw new CliError(
      'Sending from the CLI is not implemented yet. Use --dry-run, or FseGatewayClient.validate() from code.',
    );
  }

  const cdaBytes = await readLimitedFile(io.cwd, cdaPath, maxXmlBytes(options), 'CDA file');
  const cda = assertSafeXml(cdaBytes, { maxBytes: maxXmlBytes(options) });

  if (options.localValidation !== false) {
    const validator = await resolveXsdValidator(io, options);
    const result = await validator.validate(cda);
    if (!result.valid) {
      printResult(io, cdaPath, result, false);
      io.stderr('Local XSD validation failed: request not prepared.\n');
      return ExitCode.invalid;
    }
  }

  const header = await extractCdaHeader(cda);
  if (!header.patientFiscalCode) {
    throw new CliError(`The CDA has no recordTarget/patientRole/id with root ${CODICE_FISCALE_OID}`);
  }
  if (!header.documentTypeCode || !header.documentTypeCodeSystem)
    throw new CliError('The CDA has no ClinicalDocument/code');

  const contextFile = await loadContextFile(io, options.context);
  const { context, application } = buildRequestContext(contextFile, {
    personId: `${header.patientFiscalCode}^^^&${CODICE_FISCALE_OID}&ISO`,
    resourceHl7Type: `('${header.documentTypeCode}^^${header.documentTypeCodeSystem}')`,
  });

  const pdf = await readLimitedFile(io.cwd, pdfPath, MAX_PDF_BYTES, 'PDF file');
  const pdfWithCda = await injectCda(new Uint8Array(pdf), cda);

  const signer = await loadSigner(io);
  const tls = await loadTls(io);
  const prepared = await prepareValidationRequest(
    { baseUrl: FSE_ENVIRONMENTS[options.env], signer, application },
    { pdf: pdfWithCda, requestBody: { activity }, context },
  );

  io.stdout(
    `${JSON.stringify(
      {
        dryRun: true,
        note: 'Nothing was sent. Tokens and personal data are redacted.',
        environment: options.env,
        tls: tls
          ? 'client certificate and key loaded and matching'
          : 'not configured (FSE_TLS_CERT_FILE, FSE_TLS_KEY_FILE)',
        request: summarizePreparedRequest(prepared),
      },
      null,
      2,
    )}\n`,
  );
  return ExitCode.ok;
}
