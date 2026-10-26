import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FseError } from '@massimiliano-dev/fse-core';

/** Thrown for CLI usage and configuration problems; printed without stack trace. */
export class CliError extends FseError {}

/** Reads a file after checking it is a regular file no larger than `maxBytes`. */
export async function readLimitedFile(
  cwd: string,
  path: string,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const full = resolve(cwd, path);
  let info;
  try {
    info = await stat(full);
  } catch {
    throw new CliError(`${label} not found: ${path}`);
  }
  if (!info.isFile()) throw new CliError(`${label} is not a regular file: ${path}`);
  if (info.size > maxBytes) throw new CliError(`${label} exceeds ${maxBytes} bytes: ${path}`);
  return readFile(full);
}

/**
 * Reads a private key file. Warns when the file is readable by group or others (POSIX), like ssh does.
 * Key material is never echoed.
 */
export async function readSecretFile(
  cwd: string,
  path: string,
  label: string,
  warn: (message: string) => void,
): Promise<Buffer> {
  const full = resolve(cwd, path);
  const data = await readLimitedFile(cwd, path, 64 * 1024, label);
  if (process.platform !== 'win32') {
    const { mode } = await stat(full);
    if ((mode & 0o077) !== 0) {
      warn(`warning: ${label} ${path} is accessible by group/others; run: chmod 600 ${path}\n`);
    }
  }
  return data;
}
