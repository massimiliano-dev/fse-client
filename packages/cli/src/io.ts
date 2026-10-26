import type { FseGatewayClient, FseGatewayClientOptions } from '@massimiliano-dev/fse-gateway-client';

/** The gateway methods the CLI uses. Tests inject a fake through {@link CliIo.createGatewayClient}. */
export type CliGatewayClient = Pick<
  FseGatewayClient,
  | 'validate'
  | 'prepareValidation'
  | 'publish'
  | 'preparePublish'
  | 'replace'
  | 'prepareReplace'
  | 'delete'
  | 'prepareDelete'
  | 'updateMetadata'
  | 'updateMetadataIti57'
  | 'updateMetadataOscuramentoCatena'
  | 'prepareUpdateMetadata'
  | 'prepareUpdateMetadataOscuramentoCatena'
  | 'getStatus'
  | 'getStatusByTraceId'
  | 'waitForStatus'
  | 'prepareStatus'
  | 'close'
>;

/** Where the CLI writes and what it reads from the process. Injected so tests can capture output. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  /** Builds the gateway client. Default: `new FseGatewayClient(options)`. */
  createGatewayClient?: (options: FseGatewayClientOptions) => CliGatewayClient;
}

/**
 * Exit codes of the `fse` command.
 *
 * | Code | Meaning |
 * | ---- | ------- |
 * | 0 | success |
 * | 1 | the document or request is invalid (local validation, gateway 400/413/415/422), or the transaction ended in `BLOCKING_ERROR` |
 * | 2 | usage or configuration error (bad flags, missing credentials, production not confirmed…) |
 * | 3 | gateway or network error (401/403, 404, 409, 429, 5xx, TLS, timeouts) |
 * | 4 | `fse status --wait`: the transaction was still pending when the attempts ran out |
 */
export const ExitCode = {
  ok: 0,
  /** The document is invalid. */
  invalid: 1,
  /** Usage, configuration or runtime error. */
  error: 2,
  /** The gateway refused or failed (credentials, not found, conflict, rate limit, 5xx, network). */
  gateway: 3,
  /** Still pending after `--wait`. */
  pending: 4,
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
