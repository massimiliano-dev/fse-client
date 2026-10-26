/**
 * Compiles FSE schematrons (it-fse-catalogs `schematron/*.sch`, pinned by `pnpm sync:catalogs`) into SaxonJS
 * SEF files for `SaxonSchematronValidator`:
 *
 *   pnpm compile:schematron [name ...]        # default: schematronFSE_LAB_v27.1
 *
 *   1. downloads SchXslt 1.10.1 (MIT, the schematron → XSLT compiler) from Maven Central into
 *      vendor/schxslt-1.10.1 and verifies its SHA-256;
 *   2. vendor/it-fse-catalogs/schematron/<name>.sch → vendor/schematron-sef/<name>.xsl
 *      (xslt3 -xsl:schxslt-1.10.1/2.0/pipeline-for-svrl.xsl);
 *   3. <name>.xsl → vendor/schematron-sef/<name>.sef.json (xslt3 -export -nogo).
 *
 * `xslt3` (and `saxon-js`) are devDependencies of @massimiliano-dev/fse-validator only: they are under the
 * proprietary SaxonJS licence and are never bundled or shipped by this project. Everything lands in the
 * gitignored `vendor/` folder. Runs directly with Node.js >= 22.18 (type stripping); no shell.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const SCHXSLT_VERSION = '1.10.1';
const SCHXSLT_URL = `https://repo1.maven.org/maven2/name/dmaus/schxslt/schxslt/${SCHXSLT_VERSION}/schxslt-${SCHXSLT_VERSION}-xslt-only.zip`;
// SHA-256 of the archive above, computed on 2026-10-26 (Maven Central also publishes the SHA-1
// 44268885bc98d188a35563b6dbaf9dac7072a5c4).
const SCHXSLT_SHA256 = 'b5d5956e78750a2fcd954bee1719c7a3c7ecda18f3e9bdd55d024744f27af762';
const CATALOGS_COMMIT = 'd8c766a653f457f2ee8f28f95fbe151be3f20788';
const DEFAULT_SCHEMATRONS = ['schematronFSE_LAB_v27.1'];

const run = promisify(execFile);

async function ensureSchxslt(vendor: string): Promise<string> {
  const dir = join(vendor, `schxslt-${SCHXSLT_VERSION}`);
  if (existsSync(join(dir, '2.0', 'pipeline-for-svrl.xsl'))) return dir;
  console.log(`Downloading SchXslt ${SCHXSLT_VERSION} from Maven Central …`);
  const response = await fetch(SCHXSLT_URL, { redirect: 'error' });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(zip).digest('hex');
  if (digest !== SCHXSLT_SHA256) throw new Error(`SchXslt archive SHA-256 mismatch: ${digest}`);
  const tmp = join(vendor, `.schxslt-${randomBytes(4).toString('hex')}`);
  await mkdir(tmp, { recursive: true });
  try {
    await writeFile(join(tmp, 'schxslt.zip'), zip);
    await run('unzip', ['-q', join(tmp, 'schxslt.zip'), '-d', tmp]);
    await rename(join(tmp, `schxslt-${SCHXSLT_VERSION}`), dir);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return dir;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const vendor = join(repoRoot, 'vendor');
  const catalogs = join(vendor, 'it-fse-catalogs');
  const marker = await readFile(join(catalogs, '.fse-catalogs-commit'), 'utf8').catch(() => '');
  if (marker.trim() !== CATALOGS_COMMIT) {
    throw new Error('vendor/it-fse-catalogs is missing or at another commit: run "pnpm sync:catalogs" first');
  }
  const xslt3 = join(import.meta.dirname, '..', 'node_modules', '.bin', 'xslt3');
  if (!existsSync(xslt3)) throw new Error('xslt3 is not installed: run "pnpm install" (devDependency)');

  const schxslt = await ensureSchxslt(vendor);
  const out = join(vendor, 'schematron-sef');
  await mkdir(out, { recursive: true });
  const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_SCHEMATRONS;
  for (const name of names) {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`Invalid schematron name ${name}`);
    const sch = join(catalogs, 'schematron', `${name}.sch`);
    if (!existsSync(sch)) throw new Error(`${sch} not found`);
    const xsl = join(out, `${name}.xsl`);
    const sef = join(out, `${name}.sef.json`);
    await run(xslt3, [`-xsl:${join(schxslt, '2.0', 'pipeline-for-svrl.xsl')}`, `-s:${sch}`, `-o:${xsl}`]);
    await run(xslt3, [`-xsl:${xsl}`, `-export:${sef}`, '-nogo']);
    console.log(`${name}: ${sef}`);
  }
}

main().catch((error: unknown) => {
  console.error(`compile-schematron failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
