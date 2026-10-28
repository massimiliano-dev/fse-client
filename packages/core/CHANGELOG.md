# @massimiliano-dev/fse-core

## 0.1.0

### Minor Changes

- First public release of an **unofficial** TypeScript client for the FSE 2.0 gateway, not affiliated with the
  Ministero della Salute or Sogei. 0.x: not yet used in production, API may change. Use only the PRE
  environment with synthetic data.
  
  - `fse-core`: `redact()` for tokens, keys, fiscal codes and CDA bodies; `assertSafeXml()` (no DOCTYPE/XXE,
    UTF-8 only, size limit); error base classes.
  - `fse-validator`: local CDA2 XSD validation (WebAssembly libxml2, no native build) and Schematron validation
    through the optional, separately licensed `saxon-js` peer. The package bundles, unmodified, the XSD and
    schematron of the Ministero della Salute it-fse-catalogs repository at a pinned commit, with its LOINC and
    UCUM licence notices, and the compiled LAB schematron (about 3 MB): `createFseXsdValidator()` works offline
    with no folder, `bundledCatalogsDir()` / `bundledSchematronSefDir()` locate the files, an external checkout
    can still be passed. Only the LAB schematron is tested.
  - `fse-gateway-client`: JWT pair with per-operation claims over mutual TLS for validation, publication,
    validate-and-create, replacement, deletion, metadata updates and status (`waitForStatus()` bounded). Tested
    with mocks and against the Ministry's local test container (lite), never against PRE or PROD; FHIR
    endpoints are not exposed. Open points are marked `TODO(verify)` in the code.
  - `fse-pdf`: `cda.xml` injection into PDF and PAdES baseline B-B signing (PEM, PKCS#12 or an external hook);
    the PAdES level the gateway requires is not documented.
  - `fse-nestjs`: `FseModule.forRootAsync()` with the client and a validator (bundled catalogs by default).
  - `fse-cli`: `fse validate [--gateway]`, `publish`, `replace`, `delete`, `metadata`, `status [--wait]`, with
    production safeguards; local validation uses the bundled catalogs unless `--catalogs` or
    `FSE_CATALOGS_DIR` is set.
  
  Code is MIT; the bundled catalog files keep the Ministry's terms and LOINC® (a registered trademark of
  Regenstrief Institute, Inc.) material is used in accordance with its licence.
