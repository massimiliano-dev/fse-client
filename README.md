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

Early scaffold (0.x). The MVP is: **local XSD validation + gateway validation call + CLI**.

| Feature                                                         | Package              | Status                                                    |
| --------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| Redaction of tokens, keys, fiscal codes, CDA bodies             | `fse-core`           | ✅ implemented, tested                                    |
| Hardened XML input (no DOCTYPE/XXE, UTF-8 only, 10 MiB limit)   | `fse-core`           | ✅ implemented, tested                                    |
| Local XSD validation (official it-fse-catalogs, pinned commit)  | `fse-validator`      | ✅ implemented, tested                                    |
| Local Schematron validation (SaxonJS, optional peer dependency) | `fse-validator`      | 🟡 implemented, **untested** with FSE schematrons         |
| CDA injection into PDF as `cda.xml` attachment                  | `fse-pdf`            | ✅ implemented, tested                                    |
| PAdES signature of the PDF                                      | `fse-pdf`            | 🔌 interface only (`PadesSigner`, HSM/remote hook)        |
| JWT pair (`Authorization` + `FSE-JWT-Signature`), RS256         | `fse-gateway-client` | ✅ implemented, tested                                    |
| mTLS transport, mandatory server verification                   | `fse-gateway-client` | ✅ implemented, tested on loopback                        |
| Gateway validation `POST /documents/validation`                 | `fse-gateway-client` | ✅ implemented, tested with mocks; 🟡 not yet against PRE |
| Publication, replace, delete, metadata update                   | `fse-gateway-client` | ⛔ typed stubs (`NotImplementedError`)                    |
| Transaction status (`/status/...`)                              | `fse-gateway-client` | ⛔ not started                                            |
| NestJS module (`FseModule.forRootAsync`)                        | `fse-nestjs`         | ✅ implemented, tested                                    |
| `fse validate <file.xml>`                                       | `fse-cli`            | ✅ implemented, tested                                    |
| `fse send --dry-run`                                            | `fse-cli`            | ✅ implemented, tested (real send: ⛔ stub)               |

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

| #   | Step                                                                                                | Here                                    |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Generate **two** RSA keys and CSRs: one for **authentication** (mTLS), one for **signature** (JWTs) | manual, see below                       |
| 2   | Obtain the certificates from Sogei (test certificates for PRE first)                                | manual                                  |
| 3   | Store keys and certificates in a secret manager / HSM                                               | your infrastructure                     |
| 4   | Produce the CDA2 document                                                                           | your application                        |
| 5   | Validate locally: XSD, then schematron                                                              | ✅ XSD / 🟡 schematron                  |
| 6   | Inject the CDA into the PDF as `cda.xml` ("modalità ATTACHMENT")                                    | ✅ `injectCda()`                        |
| 7   | Sign the PDF in PAdES                                                                               | 🔌 `PadesSigner` (bring your own)       |
| 8   | Build the two JWTs (fresh per request, `attachment_hash` = SHA-256 of the PDF)                      | ✅ `createFseTokens()`                  |
| 9   | Call `POST /v1/documents/validation` over mTLS (`VERIFICA` or `VALIDATION`)                         | ✅ `client.validate()`, CLI `--dry-run` |
| 10  | Publish with the returned `workflowInstanceId` (`POST /v1/documents`)                               | ⛔ stub                                 |
| 11  | Check the transaction status                                                                        | ⛔ not started                          |

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

### 2–9 in code

```ts
import { readFile } from 'node:fs/promises';
import { FseGatewayClient, RsaPemJwtSigner, FseValidationError } from '@massimiliano-dev/fse-gateway-client';
import { createFseXsdValidator } from '@massimiliano-dev/fse-validator';
import { injectCda } from '@massimiliano-dev/fse-pdf';

const validator = await createFseXsdValidator('vendor/it-fse-catalogs');
const local = await validator.validate(cdaXml);
if (!local.valid) throw new Error('CDA not valid');

const pdf = await padesSigner.sign(await injectCda(basePdf, cdaXml)); // inject first, then sign

const client = new FseGatewayClient({
  environment: 'pre',
  tls: { cert: await secrets.get('fse-auth-cert'), key: await secrets.get('fse-auth-key') },
  signer: RsaPemJwtSigner.fromPem({
    certificatePem: await secrets.get('fse-sign-cert'),
    privateKeyPem: await secrets.get('fse-sign-key'),
  }),
  application: { id: 'MYAPP', vendor: 'MY VENDOR', version: '1.0.0' }, // registered at accreditation
});

try {
  const result = await client.validate({
    pdf,
    requestBody: { activity: 'VERIFICA' }, // mode ATTACHMENT and healthDataFormat CDA are the defaults
    context: {
      subject: operatorCx, // operator fiscal code, IHE CX format
      subjectRole: 'AAS',
      subjectOrganizationId: '190',
      subjectOrganization: 'Regione Sicilia',
      locality: facilityXon, // XON format
      personId: patientCx,
      patientConsent: true,
      resourceHl7Type: "('11488-4^^2.16.840.1.113883.6.1')",
    },
  });
  console.log(result.workflowInstanceId, result.warning);
} catch (error) {
  if (error instanceof FseValidationError) console.error(error.errors); // redacted RFC 7807 problems
  throw error;
} finally {
  await client.close();
}
```

To sign JWTs with an HSM or a cloud KMS, implement `FseJwtSigner` (`certificateCommonName` + `sign(claims)`)
instead of using `RsaPemJwtSigner`.

### CLI: `fse send --dry-run`

```sh
export FSE_SIGN_CERT_FILE=/run/secrets/fse-sign.crt FSE_SIGN_KEY_FILE=/run/secrets/fse-sign.key
export FSE_TLS_CERT_FILE=/run/secrets/fse-auth.crt  FSE_TLS_KEY_FILE=/run/secrets/fse-auth.key
export FSE_CONTEXT_FILE=./context.json            # see examples/context.example.json
fse send cda.xml document.pdf --env pre --dry-run
```

It validates the CDA locally, injects it into the PDF, reads the patient and document type from the CDA
header, signs the two JWTs and prints a summary in which tokens and personal claims are replaced by
`[REDACTED]`. Nothing is sent: real sending from the CLI is not implemented yet.

**Credentials are read only from environment variables pointing to files**, never from flags (flags end up
in shell history and in `ps` output). The CLI warns when a key file is readable by group or others.

| Variable                                    | Content                                         |
| ------------------------------------------- | ----------------------------------------------- |
| `FSE_SIGN_CERT_FILE`, `FSE_SIGN_KEY_FILE`   | signature certificate and key (PEM)             |
| `FSE_SIGN_KEY_PASSPHRASE`                   | passphrase of the signature key, if encrypted   |
| `FSE_TLS_CERT_FILE`, `FSE_TLS_KEY_FILE`     | authentication (mTLS) certificate and key (PEM) |
| `FSE_TLS_KEY_PASSPHRASE`, `FSE_TLS_CA_FILE` | key passphrase, extra CA for the gateway server |
| `FSE_CONTEXT_FILE`                          | operator/organisation context (JSON)            |
| `FSE_CATALOGS_DIR`                          | it-fse-catalogs checkout (not a secret)         |

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

| Repository                                                                                 | Used for                                                                    | Commit read         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------- |
| [it-fse-support](https://github.com/ministero-salute/it-fse-support)                       | OpenAPI `openapi/gateway/swagger_gtw.yaml`, integration guide, environments | `cf7b7822`          |
| [it-fse-catalogs](https://github.com/ministero-salute/it-fse-catalogs)                     | XSD and schematron (`pnpm sync:catalogs`)                                   | `d8c766a6` (pinned) |
| [it-fse-gtw-tools](https://github.com/ministero-salute/it-fse-gtw-tools)                   | JWT claims and signing, `cda.xml` injection (reference Java tools)          | `6967f3ab`          |
| [it-fse-gtw-test-container](https://github.com/ministero-salute/it-fse-gtw-test-container) | local gateway containers and request examples                               | `d9e763a3`          |

Environments: PRE `https://modipa-val.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1`, PROD
`https://modipa.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Synthetic data only.

## License

[MIT](LICENSE) © Massimiliano Polce. The official catalogs downloaded into `vendor/` are not part of this
project and keep their own terms.
