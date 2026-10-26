import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRegularFile, type FseFileError } from '../src/index.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fse-read-'));
  await writeFile(join(dir, 'ok.txt'), 'hello');
  await chmod(join(dir, 'ok.txt'), 0o640);
  await writeFile(join(dir, 'big.txt'), 'x'.repeat(2048));
  await symlink(join(dir, 'ok.txt'), join(dir, 'link.txt'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const reason = (p: Promise<unknown>) => p.catch((e: FseFileError) => e.reason);

describe('readRegularFile', () => {
  it('reads a regular file and returns its mode from the same descriptor', async () => {
    const { data, mode } = await readRegularFile(join(dir, 'ok.txt'), { maxBytes: 100 });
    expect(data.toString()).toBe('hello');
    expect(mode & 0o777).toBe(0o640);
  });

  it('refuses directories, missing files and files over the limit', async () => {
    expect(await reason(readRegularFile(dir, { maxBytes: 100 }))).toBe('not-regular');
    expect(await reason(readRegularFile(join(dir, 'nope'), { maxBytes: 100 }))).toBe('not-found');
    expect(await reason(readRegularFile(join(dir, 'big.txt'), { maxBytes: 1024 }))).toBe('too-large');
  });

  it('follows symlinks only when allowed', async () => {
    await expect(readRegularFile(join(dir, 'link.txt'), { maxBytes: 100 })).resolves.toBeDefined();
    expect(await reason(readRegularFile(join(dir, 'link.txt'), { maxBytes: 100, noFollow: true }))).toBe(
      'symlink',
    );
  });
});
