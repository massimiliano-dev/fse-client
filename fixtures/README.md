# Test fixtures (SYNTHETIC ONLY)

Everything in this folder is **synthetic**. Nothing here describes a real person, document or organisation.

| Fixture                     | What it is                                                                                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cda/synthetic-minimal.xml` | Minimal CDA2 header + one section. Fake patient "Paziente Sintetico", fiscal code `PROVAX00X00X000Y` (the placeholder used in the Ministero della Salute examples; invalid on purpose: `X` is not a month letter).                                                               |
| `cda/synthetic-lab.xml`     | Original synthetic laboratory report (LOINC 11502-2) written for the tests: same fake patient, fake operator `OPERAT00X00X000Z`, fake organisation. Passes the official XSD and the official LAB schematron (`schematronFSE_LAB_v27.1.sch`). Not derived from any real document. |
| `src/pdf.ts`                | Generates a tiny one-page PDF in memory, without dependencies.                                                                                                                                                                                                                   |
| `src/certificate.ts`        | Generates a throwaway RSA key and self-signed X.509 certificate **in memory** for tests. Never written to the repository.                                                                                                                                                        |
| `src/schema.ts`             | A tiny XSD used by unit tests, so that CI does not need the official catalogs.                                                                                                                                                                                                   |

Rules:

- **Never** add real CDA documents, PDFs, fiscal codes, certificates or private keys here, not even "anonymised" ones.
- The minimal CDA validates against the `POCD_MT000040UV02` XSD but is not meant to pass the FSE schematron; the
  synthetic LAB report passes both.
- `pnpm check:secrets` fails on fiscal codes, JWTs and PEM blocks that are not marked as allowed.
