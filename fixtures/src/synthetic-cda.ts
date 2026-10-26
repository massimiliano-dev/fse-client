import { readFileSync } from 'node:fs';

/**
 * Fake fiscal code used in every synthetic fixture. It is the placeholder of the Ministero della Salute
 * examples and is invalid on purpose ("X" is not a month letter), so it can never belong to a real person.
 */
export const SYNTHETIC_FISCAL_CODE = 'PROVAX00X00X000Y';

/** IHE CX encoding of {@link SYNTHETIC_FISCAL_CODE}, as used by the `person_id` and `sub` JWT claims. */
export const SYNTHETIC_PERSON_ID = `${SYNTHETIC_FISCAL_CODE}^^^&2.16.840.1.113883.2.9.4.3.2&ISO`;

/** Absolute path of the synthetic CDA fixture. */
export const SYNTHETIC_CDA_PATH = new URL('../cda/synthetic-minimal.xml', import.meta.url);

/** Reads the synthetic minimal CDA2 document (see `fixtures/README.md`). */
export function readSyntheticCda(): string {
  return readFileSync(SYNTHETIC_CDA_PATH, 'utf8');
}
