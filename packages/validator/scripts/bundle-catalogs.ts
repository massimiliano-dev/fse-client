/**
 * Copies the official catalogs into the package (`packages/validator/catalogs/`, gitignored, listed in
 * `files`), so the published @massimiliano-dev/fse-validator validates without any download:
 *
 *   node scripts/bundle-catalogs.ts           # run by `build`; skipped with a warning without vendor/
 *   node scripts/bundle-catalogs.ts --check   # run by `prepack`: fails unless the bundle is complete
 *
 * The sources are the repository `vendor/` folder (`pnpm sync:catalogs && pnpm compile:schematron`):
 * - it-fse-catalogs `schema/`, `schematron/`, README.md, the LOINC and UCUM licence notices and the commit
 *   marker, copied only if the checkout is at the pinned commit with no modified tracked file;
 * - the compiled SEF of the schematrons in BUNDLED_SEFS.
 * Only regular files and folders are copied (no symlinks). The bundle is built in a temporary folder and
 * renamed into place. Runs directly with Node.js >= 22.18 (type stripping); only `node:` built-ins, no shell.
 * Keep FSE_CATALOGS_COMMIT in sync with src/catalogs.ts (a unit test checks it).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const FSE_CATALOGS_COMMIT = 'd8c766a653f457f2ee8f28f95fbe151be3f20788';
const MARKER = '.fse-catalogs-commit';
const CATALOG_ENTRIES = [
  MARKER,
  'README.md',
  'LOINC_short_license.txt',
  'UCUM_short_license.txt',
  'schema',
  'schematron',
];
const BUNDLED_SEFS = ['schematronFSE_LAB_v27.1'];
const HOW_TO = 'run "pnpm sync:catalogs && pnpm compile:schematron && pnpm build" in the repository';

const run = promisify(execFile);

const packageRoot = resolve(import.meta.dirname, '..');
const vendor = resolve(packageRoot, '../../vendor');
const bundle = join(packageRoot, 'catalogs');

/** Copies a tree of regular files; anything else (symlinks, devices …) is an error. Returns the bytes copied. */
async function copyTree(src: string, dest: string): Promise<number> {
  const stat = await lstat(src);
  if (stat.isDirectory()) {
    await mkdir(dest, { recursive: true });
    let bytes = 0;
    for (const name of (await readdir(src)).sort()) {
      if (name === '.git') continue;
      bytes += await copyTree(join(src, name), join(dest, name));
    }
    return bytes;
  }
  if (!stat.isFile()) throw new Error(`${src} is not a regular file`);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  return stat.size;
}

/** Problems that make a bundle unusable; empty when it is complete and at the pinned commit. */
async function problems(dir: string): Promise<string[]> {
  const found: string[] = [];
  const marker = await readFile(join(dir, 'it-fse-catalogs', MARKER), 'utf8').catch(() => '');
  if (marker.trim() !== FSE_CATALOGS_COMMIT) found.push(`${MARKER} missing or not ${FSE_CATALOGS_COMMIT}`);
  const required = [
    ...CATALOG_ENTRIES.map((entry) => join('it-fse-catalogs', entry)),
    join('it-fse-catalogs', 'schema', 'POCD_MT000040UV02', 'CDA.xsd'),
    ...BUNDLED_SEFS.map((name) => join('schematron-sef', `${name}.sef.json`)),
  ];
  for (const path of required) if (!existsSync(join(dir, path))) found.push(`${path} missing`);
  return found;
}

async function treeBytes(path: string): Promise<number> {
  const stat = await lstat(path);
  if (!stat.isDirectory()) return stat.size;
  let bytes = 0;
  for (const name of await readdir(path)) bytes += await treeBytes(join(path, name));
  return bytes;
}

async function check(): Promise<void> {
  const found = await problems(bundle);
  if (found.length > 0) {
    throw new Error(`The bundled catalogs in ${bundle} are incomplete (${found.join('; ')}): ${HOW_TO}`);
  }
  const mib = ((await treeBytes(bundle)) / 1024 / 1024).toFixed(2);
  console.log(`Bundled catalogs OK: it-fse-catalogs ${FSE_CATALOGS_COMMIT}, ${mib} MiB`);
}

async function copy(): Promise<void> {
  const catalogs = join(vendor, 'it-fse-catalogs');
  const sefs = BUNDLED_SEFS.map((name) => join(vendor, 'schematron-sef', `${name}.sef.json`));
  if (!existsSync(join(catalogs, MARKER)) || !sefs.every((sef) => existsSync(sef))) {
    console.warn(`vendor/ catalogs or compiled schematrons not found: catalogs NOT bundled; ${HOW_TO}.`);
    return;
  }
  const marker = (await readFile(join(catalogs, MARKER), 'utf8')).trim();
  // Outside a checkout git walks up to the enclosing repository, whose HEAD is not the pinned commit.
  const git = async (...args: string[]) => (await run('git', ['-C', catalogs, ...args])).stdout.trim();
  const head = await git('rev-parse', 'HEAD').catch(() => '');
  if (marker !== FSE_CATALOGS_COMMIT || head !== FSE_CATALOGS_COMMIT) {
    throw new Error(`vendor/it-fse-catalogs is not at ${FSE_CATALOGS_COMMIT}: run "pnpm sync:catalogs"`);
  }
  if ((await git('status', '--porcelain', '--untracked-files=no')) !== '') {
    throw new Error('vendor/it-fse-catalogs has local changes: run "pnpm sync:catalogs" in a clean folder');
  }

  const tmp = `${bundle}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    let bytes = 0;
    for (const entry of CATALOG_ENTRIES) {
      bytes += await copyTree(join(catalogs, entry), join(tmp, 'it-fse-catalogs', entry));
    }
    for (const [index, sef] of sefs.entries()) {
      bytes += await copyTree(sef, join(tmp, 'schematron-sef', `${BUNDLED_SEFS[index]}.sef.json`));
    }
    const found = await problems(tmp);
    if (found.length > 0) throw new Error(`Incomplete bundle: ${found.join('; ')}`);
    await rm(bundle, { recursive: true, force: true });
    await rename(tmp, bundle);
    console.log(
      `Bundled it-fse-catalogs ${FSE_CATALOGS_COMMIT} into ${bundle} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

(process.argv.includes('--check') ? check() : copy()).catch((error: unknown) => {
  console.error(`bundle-catalogs failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
