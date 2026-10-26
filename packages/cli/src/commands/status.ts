import {
  summarizePreparedRequest,
  type StatusCheckDTO,
  type TransactionStatusResult,
} from '@massimiliano-dev/fse-gateway-client';
import { CliError } from '../files.js';
import {
  checkEnvironment,
  openGateway,
  printDryRun,
  printResult,
  withClient,
  type GatewayCommandOptions,
} from '../gateway.js';
import { ExitCode, type CliIo } from '../io.js';

/** Options of `fse status`. */
export interface StatusCommandOptions extends GatewayCommandOptions {
  trace?: string;
  wait?: boolean;
  maxAttempts?: string;
  intervalMs?: string;
}

function intOption(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new CliError(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function eventLines(events: readonly StatusCheckDTO[]): string[] {
  return events.map((e) =>
    [e.eventDate, e.eventType, e.eventStatus, e.message]
      .filter((v) => v !== undefined && v !== '')
      .join('  '),
  );
}

function statusData(result: TransactionStatusResult): Record<string, unknown> {
  return { traceID: result.traceID, spanID: result.spanID, transactionData: result.transactionData };
}

/**
 * `fse status <workflowInstanceId> --env pre [--wait]` or `fse status --trace <traceId> --env pre`: the
 * transaction status services (guide §13-14). The Bearer token `sub` is the `subject` of the context file.
 * With `--wait`, polls with bounded exponential backoff (default 10 attempts); exit 0 success, 1
 * BLOCKING_ERROR, 4 still pending.
 */
export async function statusCommand(
  io: CliIo,
  workflowInstanceId: string | undefined,
  options: StatusCommandOptions,
): Promise<number> {
  const env = checkEnvironment(io, options);
  if ((workflowInstanceId === undefined) === (options.trace === undefined)) {
    throw new CliError('Pass either <workflowInstanceId> or --trace <traceId>');
  }
  if (options.wait && options.trace !== undefined) {
    throw new CliError('--wait works with <workflowInstanceId> only');
  }
  const maxAttempts = intOption(options.maxAttempts, 10, 1, 100, '--max-attempts');
  const initialDelayMs = intOption(options.intervalMs, 2000, 0, 300_000, '--interval-ms');
  const { client, contextFile } = await openGateway(io, env, options.context);
  const subject = contextFile.subject;
  return withClient(io, client, options.json, async () => {
    if (options.dryRun) {
      const prepared = await client.prepareStatus(
        options.trace !== undefined
          ? { traceId: options.trace, subject }
          : { workflowInstanceId: workflowInstanceId ?? '', subject },
      );
      printDryRun(io, env, summarizePreparedRequest(prepared));
      return ExitCode.ok;
    }
    if (options.trace !== undefined) {
      const result = await client.getStatusByTraceId(options.trace, { subject });
      printResult(
        io,
        options.json,
        { ok: true, operation: 'status', ...statusData(result) },
        eventLines(result.transactionData).join('\n') || '(no events)',
      );
      return ExitCode.ok;
    }
    const id = workflowInstanceId ?? '';
    if (!options.wait) {
      const result = await client.getStatus(id, { subject });
      printResult(
        io,
        options.json,
        { ok: true, operation: 'status', ...statusData(result) },
        eventLines(result.transactionData).join('\n') || '(no events)',
      );
      return ExitCode.ok;
    }
    const waited = await client.waitForStatus(id, { subject, maxAttempts, initialDelayMs });
    const events = waited.status?.transactionData ?? [];
    printResult(
      io,
      options.json,
      {
        ok: waited.outcome === 'success',
        operation: 'status',
        outcome: waited.outcome,
        attempts: waited.attempts,
        ...(waited.status ? statusData(waited.status) : {}),
      },
      [...eventLines(events), `${waited.outcome.toUpperCase()} after ${waited.attempts} attempt(s)`].join(
        '\n',
      ),
    );
    return waited.outcome === 'success'
      ? ExitCode.ok
      : waited.outcome === 'failure'
        ? ExitCode.invalid
        : ExitCode.pending;
  });
}
