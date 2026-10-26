import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { FseError } from './errors.js';

export interface ReadRegularFileOptions {
  /** Refuse files larger than this, checked on the bytes actually read. */
  maxBytes: number;
  /** Refuse a symbolic link as the final path component (O_NOFOLLOW). Default false. */
  noFollow?: boolean;
}

export interface ReadRegularFileResult {
  data: Buffer;
  /** File mode from the same open descriptor, e.g. to warn about loose key permissions. */
  mode: number;
}

/** The path is missing, unreadable, not a regular file, a refused symlink, or too large. */
export class FseFileError extends FseError {
  constructor(
    message: string,
    readonly reason: 'not-found' | 'not-regular' | 'too-large' | 'symlink',
  ) {
    super(message);
  }
}

/**
 * Reads a regular file without a check-then-use race: the file is opened once, and the type check, the
 * size limit and the read all use that descriptor, so the file cannot be swapped in between.
 * `O_NONBLOCK` keeps a FIFO from blocking the process; the byte limit is enforced while reading, so a
 * file that grows after the check is still refused.
 */
export async function readRegularFile(
  path: string,
  options: ReadRegularFileOptions,
): Promise<ReadRegularFileResult> {
  const flags =
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (options.noFollow ? (constants.O_NOFOLLOW ?? 0) : 0);
  let handle: FileHandle;
  try {
    handle = await open(path, flags);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (options.noFollow && (code === 'ELOOP' || code === 'EMLINK')) {
      throw new FseFileError(`${path} is a symbolic link`, 'symlink');
    }
    throw new FseFileError(`${path} cannot be opened`, 'not-found');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FseFileError(`${path} is not a regular file`, 'not-regular');
    if (info.size > options.maxBytes) {
      throw new FseFileError(`${path} exceeds ${options.maxBytes} bytes`, 'too-large');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, options.maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > options.maxBytes) {
        throw new FseFileError(`${path} exceeds ${options.maxBytes} bytes`, 'too-large');
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return { data: Buffer.concat(chunks, total), mode: info.mode };
  } finally {
    await handle.close();
  }
}
