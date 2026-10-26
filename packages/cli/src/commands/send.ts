import type { CliIo } from '../io.js';
import { gatewayValidateCommand, type GatewayValidateOptions } from './gateway-validate.js';

/** Options of `fse send`. */
export type SendCommandOptions = GatewayValidateOptions;

/**
 * `fse send <cda.xml> <pdf> --env pre [--dry-run]`: kept for compatibility, same as
 * `fse validate <cda.xml> --gateway --pdf <pdf>`.
 */
export function sendCommand(
  io: CliIo,
  cdaPath: string,
  pdfPath: string,
  options: SendCommandOptions,
): Promise<number> {
  return gatewayValidateCommand(io, cdaPath, { ...options, pdf: pdfPath });
}
