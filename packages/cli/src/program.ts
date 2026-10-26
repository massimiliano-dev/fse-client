import { Command, CommanderError, Option } from 'commander';
import { FseError, redact } from '@massimiliano-dev/fse-core';
import { sendCommand, type SendCommandOptions } from './commands/send.js';
import { validateCommand, type ValidateCommandOptions } from './commands/validate.js';
import { ExitCode, type CliIo } from './io.js';

function buildProgram(io: CliIo, setExit: (code: number) => void): Command {
  const program = new Command('fse')
    .description('Unofficial FSE 2.0 tools: local CDA2 validation and gateway request preparation.')
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .showHelpAfterError();

  const localValidation = (cmd: Command) =>
    cmd
      .option(
        '--catalogs <dir>',
        'it-fse-catalogs checkout (default $FSE_CATALOGS_DIR or ./vendor/it-fse-catalogs)',
      )
      .option('--schema <file.xsd>', 'validate against a single self-contained XSD instead of the catalogs')
      .addOption(
        new Option('--variant <name>', 'CDA schema variant').choices(['POCD_MT000040UV02', 'POCD_HD000040']),
      )
      .option('--max-size-mb <n>', 'maximum XML size in MiB', '10');

  localValidation(program.command('validate').argument('<file.xml>', 'CDA2 document'))
    .description('Validate a CDA2 document against the XSD. Exit code 1 if invalid.')
    .option('--json', 'machine-readable output')
    .action(async (file: string, options: ValidateCommandOptions) =>
      setExit(await validateCommand(io, file, options)),
    );

  localValidation(
    program
      .command('send')
      .argument('<cda.xml>', 'CDA2 document')
      .argument('<pdf>', 'PDF to inject the CDA into (not yet signed)'),
  )
    .description(
      'Prepare a gateway validation request (CDA injected in the PDF, signed JWTs). Only --dry-run is supported.\n' +
        'Credentials are read from FSE_SIGN_CERT_FILE, FSE_SIGN_KEY_FILE, FSE_SIGN_KEY_PASSPHRASE and\n' +
        'FSE_TLS_CERT_FILE, FSE_TLS_KEY_FILE, FSE_TLS_KEY_PASSPHRASE, FSE_TLS_CA_FILE; never from flags.',
    )
    .addOption(
      new Option('--env <env>', 'gateway environment').choices(['pre', 'prod']).makeOptionMandatory(),
    )
    .option('--dry-run', 'build and print a redacted summary without sending')
    .addOption(
      new Option('--activity <activity>', 'validation activity')
        .choices(['VERIFICA', 'VALIDATION'])
        .default('VERIFICA'),
    )
    .option('--context <file.json>', 'operator/organisation context (default $FSE_CONTEXT_FILE)')
    .option('--no-local-validation', 'skip the local XSD validation')
    .action(async (cda: string, pdf: string, options: SendCommandOptions) =>
      setExit(await sendCommand(io, cda, pdf, options)),
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
