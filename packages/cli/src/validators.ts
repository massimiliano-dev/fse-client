import { resolve } from 'node:path';
import {
  createFseXsdValidator,
  XsdValidator,
  type CdaValidator,
  type FseCdaSchemaVariant,
} from '@massimiliano-dev/fse-validator';
import { readLimitedFile } from './files.js';
import type { CliIo } from './io.js';

/** Options shared by commands that validate locally. */
export interface LocalValidationOptions {
  catalogs?: string;
  schema?: string;
  variant?: string;
  maxSizeMb?: string;
}

/** Maximum XML size from `--max-size-mb` (default 10). */
export function maxXmlBytes(options: LocalValidationOptions): number {
  const mb = Number(options.maxSizeMb ?? '10');
  if (!Number.isFinite(mb) || mb <= 0 || mb > 100)
    throw new RangeError('--max-size-mb must be between 0 and 100');
  return Math.floor(mb * 1024 * 1024);
}

/**
 * `--schema <file.xsd>`: a single self-contained XSD. Otherwise the CDA2 XSD from the it-fse-catalogs
 * checkout in `--catalogs`, `FSE_CATALOGS_DIR` or `./vendor/it-fse-catalogs`.
 */
export async function resolveXsdValidator(io: CliIo, options: LocalValidationOptions): Promise<CdaValidator> {
  const maxInputBytes = maxXmlBytes(options);
  if (options.schema) {
    const contents = (await readLimitedFile(io.cwd, options.schema, 10 * 1024 * 1024, 'Schema')).toString(
      'utf8',
    );
    return new XsdValidator({ entry: { fileName: 'schema.xsd', contents }, includes: [] }, { maxInputBytes });
  }
  const dir = resolve(io.cwd, options.catalogs ?? io.env.FSE_CATALOGS_DIR ?? 'vendor/it-fse-catalogs');
  const variant = (options.variant ?? 'POCD_MT000040UV02') as FseCdaSchemaVariant;
  if (variant !== 'POCD_MT000040UV02' && variant !== 'POCD_HD000040') {
    throw new RangeError('--variant must be POCD_MT000040UV02 or POCD_HD000040');
  }
  return createFseXsdValidator(dir, { variant, maxInputBytes });
}
