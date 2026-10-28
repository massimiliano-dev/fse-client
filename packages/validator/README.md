# @massimiliano-dev/fse-validator

Local CDA2 validation for FSE 2.0: XSD (WebAssembly libxml2, no native build) and optional Schematron via SaxonJS.
The official XSD and schematron files are bundled: validation works offline right after `npm install`.

> **Unofficial**: not affiliated with the Ministero della Salute or Sogei. Test only in the PRE environment
> with synthetic data. See the [main README](https://github.com/massimiliano-dev/fse-client#readme) for the
> feature status, the full flow and the security model.

## Usage

```ts
import { createFseXsdValidator } from '@massimiliano-dev/fse-validator';

const validator = await createFseXsdValidator(); // bundled catalogs, pinned commit
const result = await validator.validate(cdaXml); // { valid, issues }
```

`loadFseCdaSchema()` and `createFseXsdValidator()` use the bundled catalogs when no folder is given
(`createFseXsdValidator(undefined, { variant: 'POCD_HD000040' })` to pass only options). To use another
it-fse-catalogs checkout, pass its folder: it must contain the `.fse-catalogs-commit` marker written by
`pnpm sync:catalogs` of this repository, and the marker must match `FSE_CATALOGS_COMMIT` unless
`loadFseCdaSchema(dir, { allowOtherCommit: true })`. The bundled copy carries the same marker and goes
through the same check.

Schematron (needs the optional peer `saxon-js`, under Saxonica's licence, installed by you):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundledSchematronSefDir, SaxonSchematronValidator } from '@massimiliano-dev/fse-validator';

const lab = new SaxonSchematronValidator({
  schematronName: 'schematronFSE_LAB_v27.1',
  sef: readFileSync(join(bundledSchematronSefDir(), 'schematronFSE_LAB_v27.1.sef.json'), 'utf8'),
});
```

`bundledCatalogsDir()` and `bundledSchematronSefDir()` return the absolute folders inside the installed
package; the `.sch` sources of every schematron are in `join(bundledCatalogsDir(), 'schematron')`.

## Bundled files

From [it-fse-catalogs](https://github.com/ministero-salute/it-fse-catalogs) at commit
`d8c766a653f457f2ee8f28f95fbe151be3f20788`, unmodified, in `catalogs/it-fse-catalogs/`:

- `schema/` (CDA2 XSD, variants `POCD_MT000040UV02` and `POCD_HD000040`) and `schematron/` (`.sch` files);
- `README.md`, `LOINC_short_license.txt`, `UCUM_short_license.txt`;
- `.fse-catalogs-commit` (the pinned commit, added by this project).

Compiled by this project, in `catalogs/schematron-sef/`: `schematronFSE_LAB_v27.1.sef.json`, the official LAB
schematron compiled with SchXslt 1.10.1 and `xslt3` (`pnpm compile:schematron`). About 3 MB unpacked.

The dictionaries (`terminology/`), FHIR mappings and container files of it-fse-catalogs are not included.

## Licence and attribution

- **Code**: [MIT](LICENSE) © Massimiliano Polce. The MIT licence covers only the code of this package.
- **it-fse-catalogs**: this package redistributes files of the
  [it-fse-catalogs](https://github.com/ministero-salute/it-fse-catalogs) repository of the **Ministero della
  Salute** (XSD, schematron, README), unmodified, as listed above. They are the Ministry's work, keep its terms
  and are not relicensed under MIT. The repository has no licence file at the pinned commit.
- **LOINC**: the catalogs contain content from LOINC (http://loinc.org). LOINC is copyright © 1995-2023,
  Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is
  available at no cost under the licence at http://loinc.org/license. **LOINC® is a registered United States
  trademark of Regenstrief Institute, Inc.** The LOINC material is used in accordance with its licence; the
  notice is in `catalogs/it-fse-catalogs/LOINC_short_license.txt`.
- **UCUM**: the catalogs contain content from The Unified Code for Units of Measure (UCUM, https://ucum.org),
  copyright © 1999-2022, Regenstrief Institute, Inc., licence at https://ucum.org/license; the notice is in
  `catalogs/it-fse-catalogs/UCUM_short_license.txt`.
- **SchXslt**: the SEF is generated with [SchXslt](https://doi.org/10.5281/zenodo.1495494) 1.10.1, MIT,
  copyright © 2018-2021 David Maus. Running it needs `saxon-js`, which is not included.
