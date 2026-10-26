import {
  summarizePreparedRequest,
  type PublicationCreationReqDTO,
  type PublicationResult,
  type PublicationUpdateReqDTO,
  type UpdateMetadataReqDTO,
  type WorkflowResult,
} from '@massimiliano-dev/fse-gateway-client';
import { isPdfSigned } from '@massimiliano-dev/fse-pdf';
import { CliError } from '../files.js';
import {
  checkEnvironment,
  contextFor,
  loadPatientFile,
  loadPreparedPdf,
  openGateway,
  printDryRun,
  printResult,
  readJsonFile,
  withClient,
  type GatewayCommandOptions,
} from '../gateway.js';
import { ExitCode, type CliIo } from '../io.js';
import { maxXmlBytes } from '../validators.js';

/** Options of `fse publish` and `fse replace`. */
export interface UploadCommandOptions extends GatewayCommandOptions {
  /** JSON file with the request body (PublicationCreationReqDTO / PublicationUpdateReqDTO). */
  metadata?: string;
  workflowInstanceId?: string;
  maxSizeMb?: string;
}

/** Options of `fse delete`. */
export interface DeleteCommandOptions extends GatewayCommandOptions {
  patient?: string;
}

/** Options of `fse metadata`. */
export interface MetadataCommandOptions extends GatewayCommandOptions {
  metadata?: string;
  patient?: string;
  endpoint?: string;
}

function publicationLines(label: string, result: PublicationResult | WorkflowResult): string {
  return [
    `${label} (HTTP ${result.httpStatus})`,
    result.workflowInstanceId ? `workflowInstanceId: ${result.workflowInstanceId}` : undefined,
    result.traceID ? `traceID: ${result.traceID}` : undefined,
    result.warning ? `warning: ${result.warning}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

async function readMetadata(io: CliIo, path: string | undefined): Promise<Record<string, unknown>> {
  if (!path) throw new CliError('--metadata <file.json> is required (the request body of the gateway call)');
  const value = await readJsonFile(io, path, 'Metadata file');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CliError('The metadata file must contain a JSON object');
  }
  return value as Record<string, unknown>;
}

async function warnIfUnsigned(io: CliIo, pdf: Uint8Array): Promise<void> {
  if (!(await isPdfSigned(pdf))) {
    io.stderr(
      'warning: the PDF has no signature. The gateway requires a PAdES-signed PDF for publication (guide §2).\n',
    );
  }
}

/**
 * `fse publish <document.pdf> --metadata <body.json> --workflow-instance-id <id> --env pre`:
 * `POST /documents`. The PDF must already contain `cda.xml` and should be PAdES-signed; the
 * `workflowInstanceId` comes from a previous `fse validate --gateway --activity VALIDATION`.
 */
export async function publishCommand(
  io: CliIo,
  pdfPath: string,
  options: UploadCommandOptions,
): Promise<number> {
  const env = checkEnvironment(io, options);
  const body = await readMetadata(io, options.metadata);
  const workflowInstanceId = options.workflowInstanceId ?? body.workflowInstanceId;
  if (typeof workflowInstanceId !== 'string' || workflowInstanceId === '') {
    throw new CliError(
      'A workflowInstanceId is required (--workflow-instance-id or in the metadata file): validate first with\n' +
        '"fse validate <document> --gateway --activity VALIDATION". Guide §2: publication must follow a validation.',
    );
  }
  const doc = await loadPreparedPdf(io, pdfPath, maxXmlBytes(options));
  await warnIfUnsigned(io, doc.pdf);
  const { client, contextFile } = await openGateway(io, env, options.context);
  const input = {
    pdf: doc.pdf,
    requestBody: { ...body, workflowInstanceId } as PublicationCreationReqDTO,
    context: contextFor(contextFile, doc),
  };
  return withClient(io, client, options.json, async () => {
    if (options.dryRun) {
      printDryRun(io, env, summarizePreparedRequest(await client.preparePublish(input)));
      return ExitCode.ok;
    }
    const result = await client.publish(input);
    printResult(
      io,
      options.json,
      { ok: true, operation: 'publish', ...result },
      publicationLines('ACCEPTED', result),
    );
    return ExitCode.ok;
  });
}

/** `fse replace <idDoc> <document.pdf> --metadata <body.json> --env pre`: `PUT /documents/{idDoc}`. */
export async function replaceCommand(
  io: CliIo,
  documentId: string,
  pdfPath: string,
  options: UploadCommandOptions,
): Promise<number> {
  const env = checkEnvironment(io, options);
  const body = await readMetadata(io, options.metadata);
  const doc = await loadPreparedPdf(io, pdfPath, maxXmlBytes(options));
  await warnIfUnsigned(io, doc.pdf);
  const { client, contextFile } = await openGateway(io, env, options.context);
  const input = {
    documentId,
    pdf: doc.pdf,
    requestBody: {
      ...body,
      ...(options.workflowInstanceId ? { workflowInstanceId: options.workflowInstanceId } : {}),
    } as PublicationUpdateReqDTO,
    context: contextFor(contextFile, doc),
  };
  return withClient(io, client, options.json, async () => {
    if (options.dryRun) {
      printDryRun(io, env, summarizePreparedRequest(await client.prepareReplace(input)));
      return ExitCode.ok;
    }
    const result = await client.replace(input);
    printResult(
      io,
      options.json,
      { ok: true, operation: 'replace', ...result },
      publicationLines('ACCEPTED', result),
    );
    return ExitCode.ok;
  });
}

/** `fse delete <idDoc> --patient <patient.json> --env pre`: `DELETE /documents/{idDoc}`. */
export async function deleteCommand(
  io: CliIo,
  documentId: string,
  options: DeleteCommandOptions,
): Promise<number> {
  const env = checkEnvironment(io, options);
  const patient = await loadPatientFile(io, options.patient);
  const { client, contextFile } = await openGateway(io, env, options.context);
  const input = { documentId, context: contextFor(contextFile, patient) };
  return withClient(io, client, options.json, async () => {
    if (options.dryRun) {
      printDryRun(io, env, summarizePreparedRequest(await client.prepareDelete(input)));
      return ExitCode.ok;
    }
    const result = await client.delete(input);
    const label = result.httpStatus === 200 ? 'DELETED' : 'ACCEPTED';
    printResult(
      io,
      options.json,
      { ok: true, operation: 'delete', ...result },
      publicationLines(label, result),
    );
    return ExitCode.ok;
  });
}

/**
 * `fse metadata <idDoc> --metadata <body.json> --patient <patient.json> --env pre
 * [--endpoint metadata|iti-57|oscuramento-catena]`: metadata update. `oscuramento-catena` needs no
 * metadata file (the body is fixed to P99 by the guide, §9).
 */
export async function metadataCommand(
  io: CliIo,
  documentId: string,
  options: MetadataCommandOptions,
): Promise<number> {
  const env = checkEnvironment(io, options);
  const endpoint = options.endpoint ?? 'metadata';
  if (endpoint !== 'metadata' && endpoint !== 'iti-57' && endpoint !== 'oscuramento-catena') {
    throw new CliError('--endpoint must be metadata, iti-57 or oscuramento-catena');
  }
  if (endpoint === 'oscuramento-catena' && env === 'prod') {
    throw new CliError(
      'The oscuramento-catena endpoint is not available in production (guide §2, Tabella 4)',
    );
  }
  const body = endpoint === 'oscuramento-catena' ? undefined : await readMetadata(io, options.metadata);
  const patient = await loadPatientFile(io, options.patient);
  const { client, contextFile } = await openGateway(io, env, options.context);
  const context = contextFor(contextFile, patient);
  return withClient(io, client, options.json, async () => {
    if (body === undefined) {
      const input = { documentId, context };
      if (options.dryRun) {
        printDryRun(
          io,
          env,
          summarizePreparedRequest(await client.prepareUpdateMetadataOscuramentoCatena(input)),
        );
        return ExitCode.ok;
      }
      const result = await client.updateMetadataOscuramentoCatena(input);
      printResult(
        io,
        options.json,
        { ok: true, operation: 'metadata', endpoint, ...result },
        publicationLines('UPDATED', result),
      );
      return ExitCode.ok;
    }
    const input = { documentId, requestBody: body as unknown as UpdateMetadataReqDTO, context };
    const variant = endpoint === 'iti-57' ? 'metadata-iti-57' : 'metadata';
    if (options.dryRun) {
      printDryRun(io, env, summarizePreparedRequest(await client.prepareUpdateMetadata(input, variant)));
      return ExitCode.ok;
    }
    const result =
      endpoint === 'iti-57' ? await client.updateMetadataIti57(input) : await client.updateMetadata(input);
    const label = result.httpStatus === 200 ? 'UPDATED' : 'ACCEPTED';
    printResult(
      io,
      options.json,
      { ok: true, operation: 'metadata', endpoint, ...result },
      publicationLines(label, result),
    );
    return ExitCode.ok;
  });
}
