import { Command, CommanderError, Option } from 'commander';
import { FseError, redact } from '@massimiliano-dev/fse-core';
import {
  deleteCommand,
  metadataCommand,
  publishCommand,
  replaceCommand,
  type DeleteCommandOptions,
  type MetadataCommandOptions,
  type UploadCommandOptions,
} from './commands/documents.js';
import { gatewayValidateCommand, type GatewayValidateOptions } from './commands/gateway-validate.js';
import { sendCommand, type SendCommandOptions } from './commands/send.js';
import { statusCommand, type StatusCommandOptions } from './commands/status.js';
import { validateCommand, type ValidateCommandOptions } from './commands/validate.js';
import { ExitCode, type CliIo } from './io.js';

const CREDENTIALS_HELP =
  'Credentials are read only from environment variables pointing to files, never from flags:\n' +
  '  FSE_SIGN_CERT_FILE, FSE_SIGN_KEY_FILE, FSE_SIGN_KEY_PASSPHRASE (JWT signature certificate)\n' +
  '  FSE_TLS_CERT_FILE, FSE_TLS_KEY_FILE, FSE_TLS_KEY_PASSPHRASE, FSE_TLS_CA_FILE (mTLS authentication)\n' +
  'Exit codes: 0 ok, 1 invalid/rejected, 2 usage or configuration, 3 gateway or network error, 4 still pending.';

function buildProgram(io: CliIo, setExit: (code: number) => void): Command {
  const program = new Command('fse')
    .description('Unofficial FSE 2.0 tools: local CDA2 validation and FSE 2.0 gateway calls.')
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .showHelpAfterError();

  const localValidation = (cmd: Command) =>
    cmd
      .option(
        '--catalogs <dir>',
        'it-fse-catalogs checkout (default $FSE_CATALOGS_DIR, else the catalogs bundled in fse-validator)',
      )
      .option('--schema <file.xsd>', 'validate against a single self-contained XSD instead of the catalogs')
      .addOption(
        new Option('--variant <name>', 'CDA schema variant').choices(['POCD_MT000040UV02', 'POCD_HD000040']),
      )
      .option('--max-size-mb <n>', 'maximum XML size in MiB', '10');

  /** Options of every command that talks to the gateway. */
  const gateway = (cmd: Command, envMandatory = true) => {
    const env = new Option('--env <env>', 'gateway environment').choices(['pre', 'prod']);
    return cmd
      .addOption(envMandatory ? env.makeOptionMandatory() : env)
      .option('--confirm-production', 'required with --env prod (real patients: accredited systems only)')
      .option('--context <file.json>', 'operator/organisation context (default $FSE_CONTEXT_FILE)')
      .option('--dry-run', 'build and print a redacted summary without sending')
      .option('--json', 'machine-readable output')
      .addHelpText('after', `\n${CREDENTIALS_HELP}`);
  };

  gateway(
    localValidation(
      program
        .command('validate')
        .argument('<file>', 'CDA2 document (.xml), or with --gateway a PDF that already contains cda.xml'),
    ),
    false,
  )
    .description(
      'Validate a CDA2 document against the XSD (exit 1 if invalid). With --gateway, also call\n' +
        'POST /documents/validation (activity VERIFICA, or VALIDATION before a publication).',
    )
    .option('--gateway', 'send the document to the gateway validation service')
    .option('--pdf <file.pdf>', 'with --gateway and an XML input: PDF to inject the CDA into')
    .addOption(
      new Option('--activity <activity>', 'gateway validation activity')
        .choices(['VERIFICA', 'VALIDATION'])
        .default('VERIFICA'),
    )
    .option('--no-local-validation', 'with --gateway: skip the local XSD validation')
    .action(
      async (
        file: string,
        options: ValidateCommandOptions & GatewayValidateOptions & { gateway?: boolean },
      ) => {
        if (!options.gateway) {
          setExit(await validateCommand(io, file, options));
          return;
        }
        setExit(await gatewayValidateCommand(io, file, options));
      },
    );

  gateway(
    localValidation(
      program
        .command('send')
        .argument('<cda.xml>', 'CDA2 document')
        .argument('<pdf>', 'PDF to inject the CDA into (not yet signed)'),
    ),
  )
    .description('Same as "fse validate <cda.xml> --gateway --pdf <pdf>" (kept for compatibility).')
    .addOption(
      new Option('--activity <activity>', 'validation activity')
        .choices(['VERIFICA', 'VALIDATION'])
        .default('VERIFICA'),
    )
    .option('--no-local-validation', 'skip the local XSD validation')
    .action(async (cda: string, pdf: string, options: SendCommandOptions) =>
      setExit(await sendCommand(io, cda, pdf, options)),
    );

  gateway(program.command('publish').argument('<document.pdf>', 'PAdES-signed PDF containing cda.xml'))
    .description(
      'Publish a document: POST /documents. The patient and document type are read from the embedded CDA.',
    )
    .requiredOption('--metadata <file.json>', 'request body (PublicationCreationReqDTO) as JSON')
    .option('--workflow-instance-id <id>', 'from "fse validate --gateway --activity VALIDATION"')
    .option('--max-size-mb <n>', 'maximum CDA size in MiB', '10')
    .action(async (pdf: string, options: UploadCommandOptions) =>
      setExit(await publishCommand(io, pdf, options)),
    );

  gateway(
    program
      .command('replace')
      .argument('<idDoc>', 'identificativoDoc (XDSDocumentEntry.uniqueId) of the document to replace')
      .argument('<document.pdf>', 'PAdES-signed PDF containing the new cda.xml'),
  )
    .description('Replace a published document: PUT /documents/{idDoc}.')
    .requiredOption('--metadata <file.json>', 'request body (PublicationUpdateReqDTO) as JSON')
    .option('--workflow-instance-id <id>', 'from a previous gateway validation')
    .option('--max-size-mb <n>', 'maximum CDA size in MiB', '10')
    .action(async (idDoc: string, pdf: string, options: UploadCommandOptions) =>
      setExit(await replaceCommand(io, idDoc, pdf, options)),
    );

  gateway(program.command('delete').argument('<idDoc>', 'identificativoDoc of the document to delete'))
    .description('Delete a published document: DELETE /documents/{idDoc}.')
    .requiredOption('--patient <file.json>', 'patient: {"personId": "...", "resourceHl7Type"?: "..."}')
    .action(async (idDoc: string, options: DeleteCommandOptions) =>
      setExit(await deleteCommand(io, idDoc, options)),
    );

  gateway(program.command('metadata').argument('<idDoc>', 'identificativoDoc of the document'))
    .description(
      'Update the metadata of a document: PUT /documents/{idDoc}/metadata (or /metadata-iti-57,\n' +
        '/metadata-oscuramento-catena).',
    )
    .option('--metadata <file.json>', 'request body (UpdateMetadataReqDTO) as JSON')
    .requiredOption('--patient <file.json>', 'patient: {"personId": "...", "resourceHl7Type": "..."}')
    .addOption(
      new Option('--endpoint <name>', 'metadata endpoint')
        .choices(['metadata', 'iti-57', 'oscuramento-catena'])
        .default('metadata'),
    )
    .action(async (idDoc: string, options: MetadataCommandOptions) =>
      setExit(await metadataCommand(io, idDoc, options)),
    );

  gateway(program.command('status').argument('[workflowInstanceId]', 'workflowInstanceId of the transaction'))
    .description('Transaction status: GET /status/{workflowInstanceId} or GET /status/search/{traceId}.')
    .option('--trace <traceId>', 'query by traceID instead of workflowInstanceId')
    .option('--wait', 'poll until the transaction succeeds or fails (bounded, exponential backoff)')
    .option('--max-attempts <n>', 'with --wait: maximum number of requests (1-100)', '10')
    .option('--interval-ms <ms>', 'with --wait: first delay between requests (doubles, max 30 s)', '2000')
    .action(async (workflowInstanceId: string | undefined, options: StatusCommandOptions) =>
      setExit(await statusCommand(io, workflowInstanceId, options)),
    );

  return program;
}

/**
 * Runs the `fse` CLI and returns the exit code. Errors are printed redacted and without stack traces.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let exitCode: number = ExitCode.ok;
  const program = buildProgram(io, (code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? ExitCode.ok : ExitCode.error;
    }
    const message =
      error instanceof FseError || error instanceof RangeError ? error.message : unexpected(error);
    io.stderr(`fse: ${redact(message)}\n`);
    return error instanceof FseError && error.name === 'UnsafeXmlError' ? ExitCode.invalid : ExitCode.error;
  }
}

function unexpected(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unexpected error';
}
