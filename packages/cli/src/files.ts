import { resolve } from 'node:path';
import { FseError, FseFileError, readRegularFile } from '@massimiliano-dev/fse-core';

/** Thrown for CLI usage and configuration problems; printed without stack trace. */
export class CliError extends FseError {}

async function readChecked(cwd: string, path: string, maxBytes: number, label: string) {
  try {
    return await readRegularFile(resolve(cwd, path), { maxBytes });
  } catch (error) {
    if (!(error instanceof FseFileError)) throw error;
    const reason =
      error.reason === 'too-large'
        ? `exceeds ${maxBytes} bytes`
        : error.reason === 'not-regular'
          ? 'is not a regular file'
          : 'not found or not readable';
    throw new CliError(`${label} ${reason}: ${path}`);
  }
}

/** Reads a regular file no larger than `maxBytes`, checking and reading through one descriptor. */
export async function readLimitedFile(
  cwd: string,
  path: string,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  return (await readChecked(cwd, path, maxBytes, label)).data;
}

/**
 * Reads a private key file. Warns when the file is readable by group or others (POSIX), like ssh does.
 * The permission check uses the same open descriptor as the read. Key material is never echoed.
 */
export async function readSecretFile(
  cwd: string,
  path: string,
  label: string,
  warn: (message: string) => void,
): Promise<Buffer> {
  const { data, mode } = await readChecked(cwd, path, 64 * 1024, label);
  if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
    warn(`warning: ${label} ${path} is accessible by group/others; run: chmod 600 ${path}\n`);
  }
  return data;
}
