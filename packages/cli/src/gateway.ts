import {
  FSE_ENVIRONMENTS,
  FseConfigError,
  FseGatewayClient,
  FseGatewayError,
  FseValidationError,
  isFseEnvironment,
  type FseEnvironment,
  type FseRequestContext,
} from '@massimiliano-dev/fse-gateway-client';
import { assertSafeXml, FseError, redact, redactValue } from '@massimiliano-dev/fse-core';
import { extractCda } from '@massimiliano-dev/fse-pdf';
import { CODICE_FISCALE_OID, extractCdaHeader } from '@massimiliano-dev/fse-validator';
import { z } from 'zod';
import { buildRequestContext, loadContextFile, type CliContextFile } from './context.js';
import { loadSigner, loadTls } from './credentials.js';
import { CliError, readLimitedFile } from './files.js';
import { ExitCode, type CliGatewayClient, type CliIo } from './io.js';

/** Options shared by every command that talks to the gateway. */
export interface GatewayCommandOptions {
  env?: string;
  confirmProduction?: boolean;
  context?: string;
  dryRun?: boolean;
  json?: boolean;
}

/** Maximum PDF size read by the CLI: 20 MiB (same default as the client). */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Checks `--env`. Production requires `--confirm-production` and always prints a warning: real patient
 * data must only come from an accredited, production-ready system.
 */
export function checkEnvironment(io: CliIo, options: GatewayCommandOptions): FseEnvironment {
  const env = options.env;
  if (!env || !isFseEnvironment(env)) throw new CliError('--env must be "pre" or "prod"');
  if (env === 'prod') {
    io.stderr(
      'WARNING: --env prod targets the PRODUCTION FSE gateway. Real patient data must only come from an\n' +
        'accredited system, never from tests or manual experiments. Use "--env pre" with synthetic data.\n',
    );
    if (!options.confirmProduction) {
      throw new CliError('Refusing to use the production gateway without --confirm-production');
    }
  }
  return env;
}

/** Loads the context file and the credentials, and builds the client (or the injected fake). */
export async function openGateway(
  io: CliIo,
  env: FseEnvironment,
  contextPath: string | undefined,
): Promise<{ client: CliGatewayClient; contextFile: CliContextFile }> {
  const contextFile = await loadContextFile(io, contextPath);
  const signer = await loadSigner(io);
  const tls = await loadTls(io);
  if (!tls) {
    throw new CliError('mTLS credentials are required: set FSE_TLS_CERT_FILE and FSE_TLS_KEY_FILE');
  }
  const options = { environment: env, tls, signer, application: contextFile.application };
  const client = io.createGatewayClient ? io.createGatewayClient(options) : new FseGatewayClient(options);
  return { client, contextFile };
}

/** A PDF with the CDA attached, and the claim values read from the CDA header. */
export interface LoadedDocument {
  pdf: Uint8Array;
  cda: string;
  personId: string;
  resourceHl7Type: string;
}

/** Reads the patient (`person_id`) and the document type (`resource_hl7_type`) from a CDA header. */
export async function claimsFromCda(cda: string): Promise<{ personId: string; resourceHl7Type: string }> {
  const header = await extractCdaHeader(cda);
  if (!header.patientFiscalCode) {
    throw new CliError(`The CDA has no recordTarget/patientRole/id with root ${CODICE_FISCALE_OID}`);
  }
  if (!header.documentTypeCode || !header.documentTypeCodeSystem) {
    throw new CliError('The CDA has no ClinicalDocument/code');
  }
  return {
    personId: `${header.patientFiscalCode}^^^&${CODICE_FISCALE_OID}&ISO`,
    resourceHl7Type: `('${header.documentTypeCode}^^${header.documentTypeCodeSystem}')`,
  };
}

/**
 * Takes a PDF that already contains `cda.xml` (as produced by `injectCda`) and extracts the claim values
 * from the embedded CDA, so a patient's fiscal code never has to be typed on the command line.
 */
export async function documentFromPdf(pdf: Uint8Array, maxXmlBytes: number): Promise<LoadedDocument> {
  const embedded = await extractCda(pdf);
  if (embedded === undefined) {
    throw new CliError('The PDF has no cda.xml attachment: inject the CDA first (fse send / injectCda)');
  }
  const cda = assertSafeXml(embedded, { maxBytes: maxXmlBytes });
  return { pdf, cda, ...(await claimsFromCda(cda)) };
}

/** Reads a PDF file that already contains `cda.xml`. See {@link documentFromPdf}. */
export async function loadPreparedPdf(io: CliIo, path: string, maxXmlBytes: number): Promise<LoadedDocument> {
  const pdf = new Uint8Array(await readLimitedFile(io.cwd, path, MAX_PDF_BYTES, 'PDF file'));
  return documentFromPdf(pdf, maxXmlBytes);
}

/** Builds the request context from the context file and the CDA claims. */
export function contextFor(
  contextFile: CliContextFile,
  claims: { personId: string; resourceHl7Type?: string },
): FseRequestContext {
  const { context } = buildRequestContext(contextFile, {
    personId: claims.personId,
    resourceHl7Type: claims.resourceHl7Type ?? '',
  });
  if (!claims.resourceHl7Type) delete context.resourceHl7Type;
  return context;
}

/** Reads and parses a JSON file (≤ 1 MiB). The request DTO itself is validated by the client. */
export async function readJsonFile(io: CliIo, path: string, label: string): Promise<unknown> {
  const raw = await readLimitedFile(io.cwd, path, 1024 * 1024, label);
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new CliError(`${label} is not valid JSON`);
  }
}

const patientSchema = z.strictObject({
  personId: z.string().min(1).max(256),
  resourceHl7Type: z.string().min(1).max(256).optional(),
});

/**
 * `--patient <file.json>`: `{ "personId": "<CF>^^^&2.16.840.1.113883.2.9.4.3.2&ISO",
 * "resourceHl7Type": "('11502-2^^2.16.840.1.113883.6.1')" }`, for operations without a CDA (delete,
 * metadata). A file, not a flag, so fiscal codes stay out of shell history and `ps`.
 */
export async function loadPatientFile(
  io: CliIo,
  path: string | undefined,
): Promise<{ personId: string; resourceHl7Type?: string }> {
  if (!path) throw new CliError('--patient <file.json> is required (personId, optional resourceHl7Type)');
  const parsed = patientSchema.safeParse(await readJsonFile(io, path, 'Patient file'));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw new CliError(`Invalid patient file, check fields: ${fields}`);
  }
  return parsed.data;
}

/** Prints a result: JSON with `--json`, otherwise `human` lines. Values are already redacted by the client. */
export function printResult(
  io: CliIo,
  json: boolean | undefined,
  data: Record<string, unknown>,
  human: string,
): void {
  if (json) io.stdout(`${JSON.stringify(redactValue(data), null, 2)}\n`);
  else io.stdout(`${human}\n`);
}

/** Prints a dry-run summary (always JSON). */
export function printDryRun(io: CliIo, env: FseEnvironment, summary: Record<string, unknown>): void {
  io.stdout(
    `${JSON.stringify(
      {
        dryRun: true,
        note: 'Nothing was sent. Tokens and personal data are redacted.',
        environment: env,
        baseUrl: FSE_ENVIRONMENTS[env],
        request: summary,
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Maps a gateway error to an exit code and prints it (redacted: `FseError` messages and `toJSON` never
 * contain tokens, keys, fiscal codes or document content).
 */
export function reportGatewayError(io: CliIo, json: boolean | undefined, error: unknown): number {
  if (!(error instanceof FseGatewayError)) {
    if (error instanceof FseConfigError) throw new CliError(error.message);
    throw error;
  }
  const code = error instanceof FseValidationError ? ExitCode.invalid : ExitCode.gateway;
  // The client already redacts problems; redact again in case an error was built elsewhere.
  if (json) io.stdout(`${JSON.stringify({ ok: false, error: redactValue(error.toJSON()) }, null, 2)}\n`);
  io.stderr(`fse: ${redact(error.message)}${error.traceId ? ` (traceID ${redact(error.traceId)})` : ''}\n`);
  if (error instanceof FseValidationError) {
    for (const issue of error.errors) {
      io.stderr(`  ${redact([issue.type, issue.title, issue.detail].filter(Boolean).join(' | '))}\n`);
    }
  }
  return code;
}

/** Runs a gateway call, closing the client afterwards and mapping gateway errors to exit codes. */
export async function withClient(
  io: CliIo,
  client: CliGatewayClient,
  json: boolean | undefined,
  run: () => Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof FseError &&
      !(error instanceof FseGatewayError) &&
      !(error instanceof FseConfigError)
    ) {
      throw error;
    }
    return reportGatewayError(io, json, error);
  } finally {
    await client.close();
  }
}
