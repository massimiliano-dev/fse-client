# Security

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/massimiliano-dev/fse-client/security/advisories/new).
You will get an answer within 7 days. Fixes are released as patch versions with an advisory.

**Never include real health data, certificates, keys or tokens in a report.** Reproduce with the synthetic
fixtures in `fixtures/`.

Supported versions: the latest minor release of 0.x.

This project is unofficial. Vulnerabilities in the FSE gateway itself must be reported to the Ministero
della Salute / Sogei through their channels, not here.

## Assets

- **Health data** (GDPR art. 9): CDA2 documents, PDFs, patient fiscal codes and names, claims such as
  `person_id`.
- **Credentials**: the authentication (mTLS) and signature private keys, their passphrases, and the JWTs
  built from them.
- **Integrity** of what is sent to the gateway on behalf of a healthcare facility.

## Threat model

| Threat                            | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Where                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Certificate / private key leakage | Keys are loaded into `KeyObject`s held in private class fields; `util.inspect`/`JSON.stringify` of signer and client never show them (tested). Errors never echo PEM input. CLI reads keys only from files named by env vars (no flags), warns on group/world-readable key files. `.gitignore`/`.dockerignore` block key and certificate files; `pnpm check:secrets` fails CI on PEM blocks. `FseJwtSigner` lets you keep the signature key in an HSM/KMS. | `gateway-client`, `cli`, CI |
| Token replay / misuse             | A fresh JWT pair per request; lifetime 5 minutes by default and at most (configurable lower, never higher); random UUID `jti`; `aud` = gateway base URL; `attachment_hash` (SHA-256) binds the signature token to the exact PDF. Tokens are never logged or put into errors.                                                                                                                                                                               | `gateway-client`            |
| PHI or secrets in logs and errors | Every library error message goes through `redact()`: JWTs, bearer tokens, PEM blocks, fiscal codes (with omocodia), CDA/XML documents, long base64. Underlying errors (sockets, TLS) are reduced to name + code, never attached as-is. XSD messages mask quoted values and drop the source lines libxml2 prints for malformed XML. Dry-run summaries mask tokens and `sub`/`person_id`/`locality`. ESLint forbids `console`.                               | all packages                |
| XXE, entity expansion, parser DoS | `assertSafeXml()` runs before any parser: rejects `<!DOCTYPE`/`<!ENTITY>` (CDA2 needs no DTD), accepts only UTF-8 (other declared encodings could hide markup), caps size (10 MiB default). libxml2 runs as WebAssembly in a worker with an in-memory file system and `--nonet`. A test shows the underlying parser **would** expand an external entity, and that the guard prevents it.                                                                   | `core`, `validator`, `pdf`  |
| MITM / server impersonation       | mTLS with the authentication certificate; server certificate verification always on (no option to disable it; `rejectUnauthorized: false` and `NODE_TLS_REJECT_UNAUTHORIZED=0` are refused); TLS ≥ 1.2; HTTPS-only base URLs without credentials; extra CAs are added to, not replacing, the default roots unless `caOnly` pins them. Tested against a local TLS server.                                                                                   | `gateway-client`            |
| Oversized or hostile responses    | Response bodies are read up to 1 MiB (configurable) then aborted; JSON is schema-checked (zod); free-text fields are redacted; timeouts on connect, headers and body; no redirects followed.                                                                                                                                                                                                                                                               | `gateway-client`            |
| Tampered official catalogs        | `pnpm sync:catalogs` fetches a pinned commit and verifies `HEAD` and a clean tree; git object ids are content hashes. A test keeps the pin in sync between script and library.                                                                                                                                                                                                                                                                             | `validator`                 |
| Supply chain                      | SHA-pinned GitHub Actions, read-only workflow permissions, Dependabot, CodeQL `security-extended`, `pnpm audit`, npm provenance. No native/postinstall dependencies. `saxon-js` is an optional peer, never installed by default.                                                                                                                                                                                                                           | CI                          |
| Secrets in CI                     | The gateway smoke test runs only on `main`/manual runs (never for pull requests), in the `fse-pre` environment, with credentials written to `umask 077` temp files and removed afterwards. PRE environment and synthetic data only.                                                                                                                                                                                                                        | `.github/workflows/ci.yml`  |

### What this library does not do

- **Store or protect your data at rest**, or manage consent: that is the responsibility of your system.
- **Sign PDFs in PAdES**: you provide a `PadesSigner` (smart card, HSM, remote signing).
- **Validate business rules beyond XSD/schematron.** The gateway remains the authority.
- **Protect against a compromised host.** Anyone who can read your process memory or key files can sign as you.

## Hardening checklist

1. Generate keys on a trusted machine with `umask 077`, encrypted with a passphrase; keep them in a secret
   manager or HSM; never in the repository, images, or CI logs.
2. Use separate certificates for authentication and signature, as required by the gateway.
3. Develop and test only against **PRE** with synthetic data. Production credentials only in production.
4. Do not log request or response bodies anywhere in your stack (reverse proxies, APM, error trackers).
   If you must log, use `redact()`/`redactValue()`.
5. Keep `tokenTtlSeconds` short; keep clocks in sync (NTP).
6. Pin the catalogs commit and review diffs of `schema/` and `schematron/` before bumping it.
7. Run the CLI with credentials from files readable only by the current user (`chmod 600`).
