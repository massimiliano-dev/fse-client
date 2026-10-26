import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FseError, FseFileError, readRegularFile } from '@massimiliano-dev/fse-core';
import { XsdValidator, type XsdSchemaSet, type XsdValidatorOptions } from './xsd.js';

/** Upper bound for a single XSD file of the catalogs. The largest official one is well under 1 MiB. */
const MAX_SCHEMA_FILE_BYTES = 5 * 1024 * 1024;

/** Official repository of XSD, schematron and dictionaries used by the gateway. */
export const FSE_CATALOGS_REPOSITORY = 'https://github.com/ministero-salute/it-fse-catalogs.git';

/**
 * Pinned commit of it-fse-catalogs (2026-10-26). Update deliberately: review the diff of `schema/` and
 * `schematron/`, then change this constant and `scripts/sync-catalogs.ts` together.
 */
export const FSE_CATALOGS_COMMIT = 'd8c766a653f457f2ee8f28f95fbe151be3f20788';

/** Marker written by `sync-catalogs.ts` with the commit actually checked out. */
export const CATALOGS_COMMIT_MARKER = '.fse-catalogs-commit';

/**
 * CDA schema variants shipped in it-fse-catalogs `schema/`. `POCD_MT000040UV02` is the one referenced by
 * the `typeId` of the official examples (it-fse-support `doc/esempi/CDA`).
 * TODO(verify): which variant the gateway applies to each document type.
 */
export type FseCdaSchemaVariant = 'POCD_MT000040UV02' | 'POCD_HD000040';

/** A loaded CDA schema with the catalogs commit it comes from. */
export interface LoadedCdaSchema {
  schema: XsdSchemaSet;
  commit: string;
  variant: FseCdaSchemaVariant;
}

/**
 * Loads the CDA2 XSD from a local it-fse-catalogs checkout made by `pnpm sync:catalogs`.
 *
 * `CDA.xsd` includes `./coreschemas/<variant>.xsd`, but in it-fse-catalogs all files are in the same
 * folder, so the other files are mounted under `coreschemas/` in xmllint's virtual file system.
 *
 * @throws {FseError} if the folder is missing, was not created by the sync script, or is at another commit
 * (unless `allowOtherCommit` is set).
 */
export async function loadFseCdaSchema(
  catalogsDir: string,
  options: { variant?: FseCdaSchemaVariant; allowOtherCommit?: boolean } = {},
): Promise<LoadedCdaSchema> {
  const variant = options.variant ?? 'POCD_MT000040UV02';
  let commit: string;
  try {
    commit = (
      await readRegularFile(join(catalogsDir, CATALOGS_COMMIT_MARKER), { maxBytes: 1024, noFollow: true })
    ).data
      .toString('utf8')
      .trim();
  } catch {
    throw new FseError(
      `No it-fse-catalogs checkout found in ${catalogsDir}. Run "pnpm sync:catalogs" or set the catalogs folder.`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new FseError('Invalid catalogs commit marker');
  if (commit !== FSE_CATALOGS_COMMIT && !options.allowOtherCommit) {
    throw new FseError(
      `it-fse-catalogs is at ${commit}, expected ${FSE_CATALOGS_COMMIT}. Run "pnpm sync:catalogs".`,
    );
  }

  const dir = join(catalogsDir, 'schema', variant);
  const names = (await readdir(dir)).filter((name) => /^[\w.-]+\.xsd$/.test(name)).sort();
  if (!names.includes('CDA.xsd')) throw new FseError(`CDA.xsd not found in ${dir}`);

  // One descriptor per file (O_NOFOLLOW): no window between the "regular file, not a symlink" check and
  // the read in which a schema could be swapped.
  const read = async (name: string) => {
    const path = join(dir, name);
    try {
      return (await readRegularFile(path, { maxBytes: MAX_SCHEMA_FILE_BYTES, noFollow: true })).data.toString(
        'utf8',
      );
    } catch (error) {
      if (error instanceof FseFileError) throw new FseError(`${path}: ${error.reason}`);
      throw error;
    }
  };
  const entry = { fileName: 'CDA.xsd', contents: await read('CDA.xsd') };
  const includes = await Promise.all(
    names
      .filter((name) => name !== 'CDA.xsd')
      .map(async (name) => ({ fileName: `coreschemas/${name}`, contents: await read(name) })),
  );
  return { schema: { entry, includes }, commit, variant };
}

/** Convenience: an {@link XsdValidator} for the CDA2 schema of a local it-fse-catalogs checkout. */
export async function createFseXsdValidator(
  catalogsDir: string,
  options: XsdValidatorOptions & { variant?: FseCdaSchemaVariant } = {},
): Promise<XsdValidator> {
  const { variant, ...validatorOptions } = options;
  const loaded = await loadFseCdaSchema(catalogsDir, variant === undefined ? {} : { variant });
  return new XsdValidator(loaded.schema, validatorOptions);
}
