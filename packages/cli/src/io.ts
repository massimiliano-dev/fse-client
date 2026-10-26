/** Where the CLI writes and what it reads from the process. Injected so tests can capture output. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
}

/** Exit codes of the `fse` command. */
export const ExitCode = {
  ok: 0,
  /** The document is invalid. */
  invalid: 1,
  /** Usage, configuration or runtime error. */
  error: 2,
} as const;

/** The process IO. */
export function processIo(): CliIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
  };
}
