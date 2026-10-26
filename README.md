# fse-client

TypeScript toolkit for Italy's **Fascicolo Sanitario Elettronico 2.0 (FSE 2.0)** gateway: local CDA2
validation, CDA injection into PDF, signed JWTs over mutual TLS, a NestJS module and an `fse` CLI.

> [!WARNING]
> **Unofficial project.** It is **not affiliated with, endorsed by or supported by** the Ministero della
> Salute, Sogei, the Dipartimento per la Trasformazione Digitale or any Region. The official documentation
> is in [ministero-salute/it-fse-support](https://github.com/ministero-salute/it-fse-support) and is the
> only authority. Using this software does not replace the official accreditation process.

> [!CAUTION]
> **Health data (GDPR art. 9).** Develop and test **only in the PRE (test) environment and only with
> synthetic data**. Never put real documents, PDFs, fiscal codes, names, JWTs, certificates or private keys
> in issues, pull requests, logs, test fixtures or chat tools, not even "anonymised" ones. Your
> organisation remains the data controller and is responsible for its DPIA and security measures.

## Status

0.x, not yet used in production. Everything below is tested with mocks; the gateway operations were also
run against the Ministry's own local gateway ([it-fse-gtw-test-container](https://github.com/ministero-salute/it-fse-gtw-test-container),
lite version), never against PRE or PROD from this repository.

| Feature                                                                                      | Package              | Status                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| Redaction of tokens, keys, fiscal codes, CDA bodies                                          | `fse-core`           | ✅ implemented, tested                                                    |
| Hardened XML input (no DOCTYPE/XXE, UTF-8 only, 10 MiB limit)                                | `fse-core`           | ✅ implemented, tested                                                    |
| Local XSD validation (official it-fse-catalogs, pinned commit)                               | `fse-validator`      | ✅ implemented, tested                                                    |
| Local Schematron validation (SaxonJS, optional peer dependency)                              | `fse-validator`      | ✅ tested with the official LAB schematron; 🟡 other schematrons untested |
| CDA injection into PDF as `cda.xml` attachment                                               | `fse-pdf`            | ✅ implemented, tested                                                    |
| PAdES baseline B-B signature (PEM, PKCS#12, or HSM/remote via a hook)                        | `fse-pdf`            | ✅ implemented, verified with OpenSSL; 🟡 required level TODO(verify)     |
| JWT pair (`Authorization` + `FSE-JWT-Signature`), per-operation claims                       | `fse-gateway-client` | ✅ implemented, tested                                                    |
| mTLS transport, mandatory server verification                                                | `fse-gateway-client` | ✅ implemented, tested on loopback                                        |
| Validation `POST /documents/validation`                                                      | `fse-gateway-client` | ✅ mocks + test container                                                 |
| Publication `POST /documents`                                                                | `fse-gateway-client` | ✅ mocks + test container                                                 |
| Validate-and-create `POST /documents/validate-and-create`                                    | `fse-gateway-client` | ✅ mocks + test container                                                 |
| Replace `PUT /documents/{idDoc}`, `PUT /documents/validate-and-replace/{idDoc}`              | `fse-gateway-client` | ✅ mocks; container reached (no INI there)                                |
| Delete `DELETE /documents/{idDoc}`                                                           | `fse-gateway-client` | ✅ mocks; container reached (no INI there)                                |
| Metadata `PUT /documents/{idDoc}/metadata`, `/metadata-iti-57`                               | `fse-gateway-client` | ✅ mocks; container reached (no INI there)                                |
| Metadata "oscuramento a catena" `PUT /documents/{idDoc}/metadata-oscuramento-catena`         | `fse-gateway-client` | ✅ mocks (PRE only, regional nodes, guide §9)                             |
| Status `GET /status/{workflowInstanceId}`, `GET /status/search/{traceId}`, `waitForStatus()` | `fse-gateway-client` | ✅ mocks + test container (by trace id); 🟡 see TODO(verify) below        |
| FHIR endpoints (`/fhir-documents`, `/fhir-documents/{idDoc}`, `/documents/fhir-validation`)  | —                    | ⛔ not exposed: request not fully specified (see below)                   |
| Health check `GET /status`                                                                   | —                    | ⛔ out of scope                                                           |
| NestJS module (`FseModule.forRootAsync`), all operations on the injected client              | `fse-nestjs`         | ✅ implemented, tested                                                    |
| CLI: `validate [--gateway]`, `publish`, `replace`, `delete`, `metadata`, `status [--wait]`   | `fse-cli`            | ✅ implemented, tested with an injected fake client                       |

**Not exposed: FHIR endpoints.** `POST /fhir-documents` and `PUT /fhir-documents/{idDoc}` exist only in the
OpenAPI, with the same CDA request DTOs as `/documents` (`healthDataFormat` can only be `CDA`), and are not
described anywhere in the integration guide. `POST /documents/fhir-validation` is described in guide §4, but
it is "Disponibile in Produzione: No" (Tabella 4), `mode` is optional in Tabella 11 and required in the
OpenAPI (`ValidationFHIRReqDTO`), the curl examples of §4.1.1/§4.1.2 point to `/documents/validation`, and
the JWT claims for a FHIR bundle (e.g. what `attachment_hash` and `resource_hl7_type` cover) are not
specified. They will be added when the sources are consistent.

**Open points (TODO(verify)).** `grep -rn "TODO(verify)" packages` lists them with the source passage. The main
ones: `administrativeRequest` is required in guide Tabelle 16/26/31/36/41 but optional in the OpenAPI and §16.2;
`workflowInstanceId` is "Obbligatorio" for publication in §16.2 but optional in Tabella 16 and the OpenAPI (the
CLI requires it); the publication example headings say "OK 200" while the status tables say 202 (both
accepted); the claims of validate-and-create/replace are inferred from creation/replacement; the PAdES level
checked by the gateway is not documented; the current dispatcher code (it-fse-gtw-dispatcher, seen in the
test container) authorises `GET /status/{workflowInstanceId}` by comparing the 3 characters after `#` in the
Bearer `sub` with those of the event issuer (`integrity:<signature CN>`, e.g. `S1#110…`), whereas guide
Tabella 54 says `sub` is the operator fiscal code: `getStatus()` takes `subject` as a parameter for this
reason.

## Packages

| npm                                    | What                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `@massimiliano-dev/fse-core`           | `redact()`, `assertSafeXml()`, error base classes                           |
| `@massimiliano-dev/fse-gateway-client` | `FseGatewayClient`, `RsaPemJwtSigner`, typed DTOs from the official OpenAPI |
| `@massimiliano-dev/fse-validator`      | `XsdValidator`, `SaxonSchematronValidator`, catalogs loader                 |
| `@massimiliano-dev/fse-pdf`            | `injectCda()`, `extractCda()`, `PadesSigner` interface                      |
| `@massimiliano-dev/fse-nestjs`         | `FseModule.forRootAsync()`                                                  |
| `@massimiliano-dev/fse-cli`            | the `fse` command                                                           |

ESM only, Node.js ≥ 22.19 (required by undici 8). No native modules: XML validation uses libxml2
compiled to WebAssembly ([xmllint-wasm](https://github.com/noppa/xmllint-wasm)).

## Quick start (local validation)

```sh
pnpm install
pnpm sync:catalogs                      # downloads XSD + schematron at the pinned it-fse-catalogs commit into vendor/
pnpm build
node packages/cli/dist/bin.js validate fixtures/cda/synthetic-minimal.xml
# VALID: fixtures/cda/synthetic-minimal.xml (0 issue(s))
```

Exit codes: `0` valid, `1` invalid (or refused as unsafe XML), `2` usage or configuration error. Issue
messages are redacted: libxml2 quotes invalid values, so values are replaced with `'[VALUE]'` and source
lines of malformed documents are never printed.

## The full flow

How a producer system talks to the gateway, according to it-fse-support
[`doc/integrazione-gateway/README.md`](https://github.com/ministero-salute/it-fse-support/tree/main/doc/integrazione-gateway)
and the root [README](https://github.com/ministero-salute/it-fse-support#richiesta-certificati-x509).

| #   | Step                                                                                                | Here                                             |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Generate **two** RSA keys and CSRs: one for **authentication** (mTLS), one for **signature** (JWTs) | manual, see below                                |
| 2   | Obtain the certificates from Sogei (test certificates for PRE first)                                | manual                                           |
| 3   | Store keys and certificates in a secret manager / HSM                                               | your infrastructure                              |
| 4   | Produce the CDA2 document                                                                           | your application                                 |
| 5   | Validate locally: XSD, then schematron                                                              | ✅ `XsdValidator`, `SaxonSchematronValidator`    |
| 6   | Inject the CDA into the PDF as `cda.xml` ("modalità ATTACHMENT")                                    | ✅ `injectCda()`                                 |
| 7   | Validate on the gateway with activity `VALIDATION` (before signing, FAQ) → `workflowInstanceId`     | ✅ `client.validate()`, `fse validate --gateway` |
| 8   | Sign the PDF in PAdES                                                                               | ✅ `P12PadesSigner` / `RawSignaturePadesSigner`  |
| 9   | Publish with the `workflowInstanceId` (`POST /v1/documents`): 202 = taken in charge                 | ✅ `client.publish()`, `fse publish`             |
| 10  | Follow the asynchronous delivery to INI/EDS (`/v1/status/...`)                                      | ✅ `client.waitForStatus()`, `fse status --wait` |
| 11  | Later: replace, update metadata or delete with the document OID (`idDoc`)                           | ✅ `replace()`, `updateMetadata()`, `delete()`   |

Fresh JWTs are signed for every call (step 7, 9, 10, 11). The gateway checks that the CDA published is the
one validated (hash of the CDA, ignoring the legal authenticator signature, guide §2), so signing the PDF
after the validation is expected; the test container even warns `SIGN_WARN - Attenzione il documento
risulta firmato in validazione` when a signed PDF is validated.

### 1. Keys and CSRs

Run on a trusted machine, never commit the output (the `.gitignore` blocks `*.key`, `*.pem`, `*.csr`…):

```sh
umask 077
openssl req -new -newkey rsa:2048 -keyout fse-auth.key -out fse-auth.csr      # authentication (mTLS)
openssl req -new -newkey rsa:2048 -keyout fse-sign.key -out fse-sign.csr      # JWT signature
```

Without `-nodes` OpenSSL encrypts the keys with a passphrase: keep it that way and provide the passphrase
through `FSE_*_KEY_PASSPHRASE` from a secret manager. The official README describes where to send the CSRs
(during the trial: `fse_support@sogei.it`; later the provisioning service). TODO(verify): the current
procedure and the CSR subject fields required by Sogei.

### 4–11 in code

```ts
import { readFile } from 'node:fs/promises';
import { FseGatewayClient, RsaPemJwtSigner, FseValidationError } from '@massimiliano-dev/fse-gateway-client';
import { createFseXsdValidator } from '@massimiliano-dev/fse-validator';
import { injectCda, P12PadesSigner } from '@massimiliano-dev/fse-pdf';

const validator = await createFseXsdValidator('vendor/it-fse-catalogs');
if (!(await validator.validate(cdaXml)).valid) throw new Error('CDA not valid');

const client = new FseGatewayClient({
  environment: 'pre',
  tls: { cert: await secrets.get('fse-auth-cert'), key: await secrets.get('fse-auth-key') },
  signer: RsaPemJwtSigner.fromPem({
    certificatePem: await secrets.get('fse-sign-cert'),
    privateKeyPem: await secrets.get('fse-sign-key'),
  }),
  application: { id: 'MYAPP', vendor: 'MY VENDOR', version: '1.0.0' }, // registered at accreditation
});

const context = {
  subject: operatorCx, // operator fiscal code, IHE CX format
  subjectRole: 'AAS',
  subjectOrganizationId: '190',
  subjectOrganization: 'Regione Sicilia',
  locality: facilityXon, // XON format, checked by the gateway for create/replace/update/delete
  personId: patientCx,
  patientConsent: true,
  resourceHl7Type: "('11502-2^^2.16.840.1.113883.6.1')",
} as const;

try {
  // 7. validation before signing (mode ATTACHMENT and healthDataFormat CDA are the defaults)
  const pdf = await injectCda(basePdf, cdaXml);
  const { workflowInstanceId } = await client.validate({
    pdf,
    requestBody: { activity: 'VALIDATION' },
    context,
  });

  // 8. PAdES baseline B-B (or RawSignaturePadesSigner with your HSM / remote signing service)
  const pades = await P12PadesSigner.fromPkcs12({ pkcs12: await secrets.get('author.p12'), passphrase });
  const signedPdf = await pades.sign(pdf);

  // 9. publication: 202 = taken in charge, delivery to INI/EDS is asynchronous
  const published = await client.publish({
    pdf: signedPdf,
    context,
    requestBody: {
      workflowInstanceId,
      identificativoDoc: '2.16.840.1.113883.2.9.2.190.4.4^DOC123',
      identificativoRep: '2.16.840.1.113883.2.9.2.190.4.5.1',
      identificativoSottomissione: '2.16.840.1.113883.2.9.2.190.4.3.1',
      tipologiaStruttura: 'Ospedale',
      tipoDocumentoLivAlto: 'REF', // must match resource_hl7_type (guide §16.4), checked locally
      assettoOrganizzativo: 'AD_PSC001',
      tipoAttivitaClinica: 'CON',
      administrativeRequest: ['SSN'],
    },
  });

  // 10. bounded polling: 10 attempts, 2 s doubling up to 30 s; never infinite
  const status = await client.waitForStatus(published.workflowInstanceId!, { subject: context.subject });
  console.log(status.outcome); // 'success' | 'failure' | 'pending'
} catch (error) {
  if (error instanceof FseValidationError) console.error(error.errors); // redacted RFC 7807 problems
  throw error;
} finally {
  await client.close();
}
```

Every request body is checked against the OpenAPI before anything is signed (unknown fields, enums,
`maxLength`, IHE DTM dates, the classCode/typeCode table of guide §16.4), path parameters are restricted to
printable ASCII without `/ \ ? # %` and percent-encoded, and `purpose_of_use` overrides are limited to the
values the guide allows for each operation:

| Operation                               | Endpoint                                                       | `action_id`                              | `purpose_of_use`                                     | `attachment_hash` | `resource_hl7_type` |
| --------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- | ----------------- | ------------------- |
| `validate`                              | `POST /documents/validation`                                   | CREATE                                   | TREATMENT                                            | yes               | required            |
| `publish`                               | `POST /documents`                                              | CREATE                                   | TREATMENT                                            | yes               | required            |
| `validateAndCreate`                     | `POST /documents/validate-and-create`                          | CREATE                                   | TREATMENT                                            | yes               | required            |
| `replace`                               | `PUT /documents/{idDoc}`                                       | UPDATE                                   | UPDATE                                               | yes               | required            |
| `validateAndReplace`                    | `PUT /documents/validate-and-replace/{idDoc}`                  | UPDATE                                   | UPDATE                                               | yes               | required            |
| `delete`                                | `DELETE /documents/{idDoc}`                                    | DELETE                                   | UPDATE                                               | no                | optional            |
| `updateMetadata`, `updateMetadataIti57` | `PUT /documents/{idDoc}/metadata`, `/metadata-iti-57`          | UPDATE                                   | UPDATE or ACCESS UPDATE                              | no                | required            |
| `updateMetadataOscuramentoCatena`       | `PUT /documents/{idDoc}/metadata-oscuramento-catena`           | UPDATE                                   | SYSADMIN (+ `subject_role` NOR, `locality` `------`) | no                | optional            |
| `getStatus`, `getStatusByTraceId`       | `GET /status/{workflowInstanceId}`, `/status/search/{traceId}` | Bearer token only (guide Tabelle 46, 51) |                                                      |                   |                     |

Sources: guide §16.1 Tabella 55, §16.3.6 Tabella 47, §16.3.12 Tabella 62, §9. Results never contain the FHIR
bundle unless you pass `includeFhirBundle: true` (it is health data). Status events are redacted (fiscal codes,
SOAP payloads).

To sign JWTs with an HSM or a cloud KMS, implement `FseJwtSigner` (`certificateCommonName` + `sign(claims)`)
instead of using `RsaPemJwtSigner`; for the PDF, give `RawSignaturePadesSigner` a `signRsaSha256(data)`
function backed by your HSM or remote signing service.

### PAdES

`P12PadesSigner` produces a PAdES baseline B-B signature (ETSI EN 319 142-1): `/SubFilter /ETSI.CAdES.detached`,
detached CMS with content-type, message-digest and **signing-certificate-v2**, no signing-time attribute (the
time is in `/M`), SHA-256 with RSA. This is the same attribute set as the Ministry's reference tool
(it-fse-gtw-tools `pdf-generator`, `CreateSignatureBasePades`). The PDF placeholder and byte ranges are done
by [`@signpdf`](https://github.com/vbuch/node-signpdf) (MIT); its own `P12Signer` is not used because it
produces an `adbe.pkcs7.detached`-style CMS (with signing-time, without signing-certificate-v2), which is not
PAdES baseline (and `@signpdf/signer-p12` needs `node-forge`, which has an unpatched advisory,
GHSA-86w9-cpqp-85rv). PKCS#12 files are read by a small built-in reader on `node:crypto` (integrity MAC
checked; PBES2/AES as written by OpenSSL 3 by default). Legacy RC2/3DES files (`openssl pkcs12 -legacy`,
older Windows exports) are refused: re-export them with
`openssl pkcs12 -export -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg sha256`, or use PEM. The accreditation only checks "la corretta apposizione della firma PADES", not
qualified certificates (it-fse-support `doc/accreditamento`). No timestamp (B-T) or revocation data (B-LT).

### CLI

```sh
export FSE_SIGN_CERT_FILE=/run/secrets/fse-sign.crt FSE_SIGN_KEY_FILE=/run/secrets/fse-sign.key
export FSE_TLS_CERT_FILE=/run/secrets/fse-auth.crt  FSE_TLS_KEY_FILE=/run/secrets/fse-auth.key
export FSE_CONTEXT_FILE=./context.json              # see examples/context.example.json

# 7. local XSD + gateway validation (CDA injected into the PDF); prints the workflowInstanceId
fse validate fixtures/cda/synthetic-lab.xml --gateway --pdf base.pdf --activity VALIDATION --env pre

# 9. publication of the signed PDF (patient and document type are read from the embedded cda.xml)
fse publish signed.pdf --metadata examples/publication.example.json \
  --workflow-instance-id '2.16.840.1.113883.2.9.2.999.4.4.abc^^^^urn:ihe:iti:xdw:2013:workflowInstanceId' --env pre

# 10. status, once or with bounded polling
fse status '2.16.840.1.113883.2.9.2.999.4.4.abc^^^^urn:ihe:iti:xdw:2013:workflowInstanceId' --env pre --wait
fse status --trace 3f67b89ba72ed40b --env pre --json

# 11. replace, metadata update, delete (operations without a CDA read the patient from a file)
fse replace '2.16.840.1.113883.2.9.2.999.4.4^DOC1' signed-v2.pdf --metadata examples/publication.example.json --env pre
fse metadata '2.16.840.1.113883.2.9.2.999.4.4^DOC1' --metadata examples/metadata.example.json \
  --patient examples/patient.example.json --env pre [--endpoint iti-57|oscuramento-catena]
fse delete '2.16.840.1.113883.2.9.2.999.4.4^DOC1' --patient examples/patient.example.json --env pre

# any of the above with --dry-run: signs the tokens and prints a redacted summary, sends nothing
```

- **Credentials only from environment variables pointing to files**, never from flags (flags end up in shell
  history and in `ps` output). The CLI warns when a key file is readable by group or others.
- **Patient data never on the command line**: `person_id` and `resource_hl7_type` come from the CDA (inside the
  PDF) or from a `--patient` JSON file.
- **Production** (`--env prod`) is refused unless `--confirm-production` is also given, and always prints a
  warning that real patient data must only come from an accredited system. `oscuramento-catena` is refused in
  production (not available there, guide Tabella 4).
- `--json` gives machine-readable output on stdout; errors go to stderr, redacted.
- `fse send <cda.xml> <pdf>` still works, as an alias of `fse validate <cda.xml> --gateway --pdf <pdf>`.

| Exit code | Meaning                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0         | success                                                                                                                     |
| 1         | invalid: local validation failed, the gateway rejected the request (400/413/415/422), or `--wait` ended in `BLOCKING_ERROR` |
| 2         | usage or configuration error (flags, credentials, invalid request body, production not confirmed)                           |
| 3         | gateway or network error (401/403, 404, 409, 429, 5xx, TLS, timeout)                                                        |
| 4         | `status --wait`: still pending when the attempts ran out                                                                    |

| Variable                                    | Content                                         |
| ------------------------------------------- | ----------------------------------------------- |
| `FSE_SIGN_CERT_FILE`, `FSE_SIGN_KEY_FILE`   | signature certificate and key (PEM)             |
| `FSE_SIGN_KEY_PASSPHRASE`                   | passphrase of the signature key, if encrypted   |
| `FSE_TLS_CERT_FILE`, `FSE_TLS_KEY_FILE`     | authentication (mTLS) certificate and key (PEM) |
| `FSE_TLS_KEY_PASSPHRASE`, `FSE_TLS_CA_FILE` | key passphrase, extra CA for the gateway server |
| `FSE_CONTEXT_FILE`                          | operator/organisation context (JSON)            |
| `FSE_CATALOGS_DIR`                          | it-fse-catalogs checkout (not a secret)         |

The CLI does not sign PDFs: sign them with your signing system, or with `P12PadesSigner` from code.

### NestJS

```ts
@Module({
  imports: [
    FseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        gateway: { environment: 'pre', tls: …, signer: …, application: … },
        validator: { catalogsDir: config.getOrThrow('FSE_CATALOGS_DIR') },
      }),
    }),
  ],
})
export class AppModule {}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(FSE_GATEWAY_CLIENT) private readonly fse: FseGatewayClient,
    @Inject(FSE_CDA_VALIDATOR) private readonly validator: CdaValidator,
  ) {}
}
```

The client's TLS connections are closed on application shutdown.

## Security

See [SECURITY.md](SECURITY.md) for the threat model. In short:

- **mTLS with mandatory server verification.** There is no option to disable it; an explicit
  `rejectUnauthorized: false` and `NODE_TLS_REJECT_UNAUTHORIZED=0` are refused. TLS ≥ 1.2. HTTPS-only URLs.
- **Short-lived tokens.** Fresh JWT pair per request, 5 minutes maximum, random `jti`, `attachment_hash`
  binding the signature token to the exact PDF.
- **No PHI or secrets in logs or errors.** Every error message goes through `redact()` (JWTs, bearer tokens,
  PEM blocks, fiscal codes, CDA/XML bodies, long base64). Underlying errors are reduced to name and code.
  Keys are held as `KeyObject`s in private fields; `util.inspect` and `JSON.stringify` never show them.
- **XXE-proof XML handling.** Any `<!DOCTYPE`/`<!ENTITY>` is refused **before** parsing. This is necessary:
  the WebAssembly libxml2 expands external entities from its virtual file system even without `--noent`
  (there is a test documenting it). UTF-8 only, 10 MiB default limit, `--nonet`, no host file system.
- **Supply chain.** SHA-pinned actions, Dependabot, CodeQL, `pnpm audit`, `pnpm check:secrets` in CI, npm
  provenance. The official catalogs are fetched at a pinned commit and verified by git object id.

## Schematron and the SaxonJS licence

Compile step (build machine only):

```sh
pnpm sync:catalogs                                  # official XSD + schematron, pinned commit, into vendor/
pnpm compile:schematron                             # default: schematronFSE_LAB_v27.1; or pass other names
# → vendor/schematron-sef/schematronFSE_LAB_v27.1.sef.json
```

`compile:schematron` downloads [SchXslt](https://doi.org/10.5281/zenodo.1495494) 1.10.1 (MIT) from Maven
Central, checks its SHA-256, compiles `.sch` → XSLT (`2.0/pipeline-for-svrl.xsl`) → SEF with `xslt3`. At run
time give the SEF to `new SaxonSchematronValidator({ schematronName, sef })` with `saxon-js` installed. Here
`saxon-js` and `xslt3` are **devDependencies of `@massimiliano-dev/fse-validator` only** (for the compile step
and the tests); for users `saxon-js` stays an optional peer dependency. Tested: the synthetic laboratory report
`fixtures/cda/synthetic-lab.xml` passes the official LAB schematron, a copy without `realmCode` reports
`ERRORE-1` and `ERRORE-2`, warnings (`W…|`) do not make a document invalid.

The FSE schematrons use `queryBinding="xslt2"`, which needs an XSLT 2/3 processor. In JavaScript the only
practical one is [SaxonJS](https://www.saxonica.com/saxonjs/). `npm view saxon-js license` says
`SEE LICENSE IN LICENSE.txt`; the `LICENSE.txt` in `saxon-js@2.7.0` is the **SaxonJS License 1.0 (June 2020)**
by Saxonica Ltd: a proprietary, no-fee licence (not OSI-approved). It allows use, and redistribution in
unmodified binary form as part of an application, provided that the Saxonica copyright notice and disclaimer
are reproduced, there is no reverse engineering, the Saxonica name is not used for endorsement, and the
software is not copied to a site whose main purpose is redistribution without permission.

**Conclusion:** an MIT package can declare `saxon-js` as an **optional peer dependency**, because this
project neither bundles nor redistributes it: users install it themselves and accept Saxonica's licence. It
must never become a regular dependency or be vendored here. If you ship an application that includes
`saxon-js`, include Saxonica's notice and disclaimer in your documentation. (Not legal advice; the same
licence covers `xslt3`, needed to compile schematron → XSLT → SEF.) This repository disables
`auto-install-peers` so `saxon-js` is never installed by accident.

## Official sources

Types and constants cite their source in TSDoc. Facts that could not be confirmed are marked
`TODO(verify)` in the code (`grep -rn "TODO(verify)" packages`).

| Repository                                                                                 | Used for                                                                            | Commit read         |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------- |
| [it-fse-support](https://github.com/ministero-salute/it-fse-support)                       | OpenAPI `openapi/gateway/swagger_gtw.yaml`, integration guide, environments         | `cf7b7822`          |
| [it-fse-catalogs](https://github.com/ministero-salute/it-fse-catalogs)                     | XSD and schematron (`pnpm sync:catalogs`)                                           | `d8c766a6` (pinned) |
| [it-fse-gtw-tools](https://github.com/ministero-salute/it-fse-gtw-tools)                   | JWT claims and signing, `cda.xml` injection (reference Java tools)                  | `6967f3ab`          |
| [it-fse-gtw-test-container](https://github.com/ministero-salute/it-fse-gtw-test-container) | local gateway containers and request examples (client run against the lite version) | `d9e763a3`          |
| [SchXslt](https://doi.org/10.5281/zenodo.1495494) 1.10.1 (Maven Central, SHA-256 pinned)   | schematron → XSLT compiler for `pnpm compile:schematron`                            | `1.10.1`            |

Environments: PRE `https://modipa-val.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1`, PROD
`https://modipa.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Synthetic data only.

## License

[MIT](LICENSE) © Massimiliano Polce. The official catalogs downloaded into `vendor/` are not part of this
project and keep their own terms.
