# @massimiliano-dev/fse-gateway-client

## 0.1.0

### Minor Changes

- 097950b: Implement every documented FSE 2.0 gateway document operation: publication (`publish`), validate-and-create,
  replacement (`replace`, `validateAndReplace`), deletion, metadata update (`/metadata`, `/metadata-iti-57`,
  `/metadata-oscuramento-catena`) and transaction status (`getStatus`, `getStatusByTraceId`, bounded
  `waitForStatus`). Request DTOs and path parameters are validated against the official OpenAPI before
  signing; JWT claims follow the per-operation rules of the integration guide. New `P12PadesSigner` /
  `RawSignaturePadesSigner` (PAdES baseline B-B, PEM or PKCS#12 via a built-in `node:crypto` reader) in `fse-pdf`, `pnpm compile:schematron` and a test against
  the official LAB schematron, and real `fse validate --gateway`, `publish`, `replace`, `delete`, `metadata`
  and `status` CLI commands with production safeguards.
  
  Breaking (0.x): `PreparedFseRequest` now carries `body` (multipart/json/none) instead of `requestBodyJson`
  and `file`; `FseRequestContext.resourceHl7Type` is optional (still required where the guide requires it);
  `redact()` also masks a fiscal code followed by stray letters.
- a451d09: Initial scaffold: local XSD validation, gateway validation call, CDA injection into PDF, NestJS module and CLI.

### Patch Changes

- Updated dependencies [097950b]
- Updated dependencies [a451d09]
  - @massimiliano-dev/fse-core@0.1.0
