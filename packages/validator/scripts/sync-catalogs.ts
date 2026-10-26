/**
 * Downloads the official FSE catalogs (XSD + schematron) from ministero-salute/it-fse-catalogs at a pinned
 * commit into `vendor/it-fse-catalogs` (gitignored).
 *
 *   pnpm sync:catalogs [targetDir]
 *
 * - Fetches exactly the pinned commit (shallow, partial clone, sparse checkout of `schema/` and
 *   `schematron/`; the full repository is over 1 GB because of the dictionaries).
 * - Verifies that the checked-out HEAD is the pinned commit. Git object ids are content hashes, so this
 *   also verifies the content of every file.
 * - Writes `.fse-catalogs-commit`, read by `loadFseCdaSchema()`.
 *
 * Runs directly with Node.js >= 22.18 (type stripping); only `node:` built-ins, no shell.
 * Keep FSE_CATALOGS_COMMIT in sync with packages/validator/src/catalogs.ts (a unit test checks it).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const FSE_CATALOGS_REPOSITORY = 'https://github.com/ministero-salute/it-fse-catalogs.git';
const FSE_CATALOGS_COMMIT = 'd8c766a653f457f2ee8f28f95fbe151be3f20788';
const MARKER = '.fse-catalogs-commit';
const SPARSE_PATHS = ['schema', 'schematron'];

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const target = resolve(process.argv[2] ?? join(repoRoot, 'vendor', 'it-fse-catalogs'));

  if (existsSync(join(target, MARKER))) {
    const marker = (await readFile(join(target, MARKER), 'utf8')).trim();
    const head = await git(target, 'rev-parse', 'HEAD').catch(() => '');
    if (marker === FSE_CATALOGS_COMMIT && head === FSE_CATALOGS_COMMIT) {
      console.log(`it-fse-catalogs already at ${FSE_CATALOGS_COMMIT} in ${target}`);
      return;
    }
  } else if (existsSync(target)) {
    throw new Error(`${target} exists but was not created by this script; refusing to overwrite it`);
  }
  if (basename(target) !== 'it-fse-catalogs') {
    throw new Error('The target folder must be named "it-fse-catalogs"');
  }

  const tmp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
  await mkdir(dirname(target), { recursive: true });
  await mkdir(tmp);
  try {
    console.log(`Fetching ${FSE_CATALOGS_REPOSITORY} @ ${FSE_CATALOGS_COMMIT} …`);
    await git(tmp, 'init', '--quiet');
    await git(tmp, 'remote', 'add', 'origin', FSE_CATALOGS_REPOSITORY);
    await git(tmp, 'sparse-checkout', 'set', ...SPARSE_PATHS);
    await git(tmp, 'fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', FSE_CATALOGS_COMMIT);
    await git(tmp, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');

    const head = await git(tmp, 'rev-parse', 'HEAD');
    if (head !== FSE_CATALOGS_COMMIT) {
      throw new Error(`Checked out ${head}, expected ${FSE_CATALOGS_COMMIT}`);
    }
    const type = await git(tmp, 'cat-file', '-t', FSE_CATALOGS_COMMIT);
    if (type !== 'commit') throw new Error(`${FSE_CATALOGS_COMMIT} is not a commit`);
    const status = await git(tmp, 'status', '--porcelain');
    if (status !== '') throw new Error('Working tree differs from the pinned commit');

    await writeFile(join(tmp, '.git', 'info', 'exclude'), `${MARKER}\n`, { flag: 'a' });
    await writeFile(join(tmp, MARKER), `${FSE_CATALOGS_COMMIT}\n`);
    await rm(target, { recursive: true, force: true });
    await rename(tmp, target);
    console.log(`it-fse-catalogs ${FSE_CATALOGS_COMMIT} ready in ${target}`);
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(`sync-catalogs failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
