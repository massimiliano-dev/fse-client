# Contributing

Thanks for helping. Issues and pull requests are welcome.

1. `pnpm install`, then `pnpm test`. For tests against the official XSD run `pnpm sync:catalogs` first
   (downloads the pinned it-fse-catalogs commit into the gitignored `vendor/`); for the official LAB
   schematron also run `pnpm compile:schematron` (SchXslt from Maven Central, SHA-256 checked, compiled with
   the `xslt3` devDependency into `vendor/schematron-sef/`). Without them those tests are skipped.
2. **Never call the real gateways from tests.** Gateway tests use undici `MockAgent`; CLI tests inject a
   fake client (`fakeGateway()` in `packages/cli/test/helpers.ts`) and the default test IO refuses to
   create a real one. To exercise a real gateway implementation locally, use the Ministry's
   [it-fse-gtw-test-container](https://github.com/ministero-salute/it-fse-gtw-test-container) (lite) behind a
   local mTLS proxy, outside the repository. Note that its seed script does not import the `engines`
   collection nor build the `dictionary` collection, so validation fails with "Nessun engine disponibile" /
   "Non è stato trovato alcun dizionario gestito su FSE" until they are added to its MongoDB.
3. **Synthetic data only.** Never commit or paste real CDA documents, PDFs, fiscal codes, names, JWTs,
   certificates or keys, not even anonymised. Use the fixtures in `fixtures/` and the in-memory test
   certificates (`createTestCertificate()`); never write key files into the repository.
4. `pnpm check:secrets` must pass. A line may opt out with `check-secrets: allow` only for documented,
   obviously fake values.
5. Facts about the gateway (endpoints, claims, codes) must cite the official source file in TSDoc; if they
   cannot be confirmed, mark them `TODO(verify)`.
6. Errors and output go through `redact()`. Security-relevant behaviour needs a test that shows the
   protection (see the XXE, TLS loopback and redaction tests).
7. Add a changeset for any change to a published package: `pnpm changeset`.

Code style is enforced by ESLint and Prettier (`pnpm lint`, `pnpm format`). Public APIs need TSDoc comments.

## Gateway smoke test (maintainers)

`pnpm test:gateway` calls the real **PRE** gateway with the synthetic CDA. It is skipped unless
`FSE_GATEWAY_ENV=pre` and the credential variables (see README) plus `FSE_CONTEXT_FILE` are set. In CI it
runs only when the repository variable `FSE_GATEWAY_ENV` is `pre`, never for pull requests, in the
`fse-pre` environment (configure required reviewers), with these secrets: `FSE_SIGN_CERT_PEM`,
`FSE_SIGN_KEY_PEM`, `FSE_SIGN_KEY_PASSPHRASE`, `FSE_TLS_CERT_PEM`, `FSE_TLS_KEY_PEM`,
`FSE_TLS_KEY_PASSPHRASE`, `FSE_CONTEXT_JSON`.
