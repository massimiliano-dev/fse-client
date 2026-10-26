## What and why

## Checklist

- [ ] Tests added or updated (`pnpm test`)
- [ ] A changeset if a published package changes (`pnpm changeset`)
- [ ] `pnpm check:secrets` passes: no certificates, keys, JWTs, `.env` files or fiscal codes in the diff
- [ ] Only synthetic data in fixtures, tests and examples (no real patients, not even anonymised)
- [ ] New error messages and logs go through `redact()` and never include tokens, keys or document content
- [ ] Facts about the gateway cite the official source, or are marked `TODO(verify)`
