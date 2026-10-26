import { readFileSync } from 'node:fs';
import { makeTestPdf, readSyntheticCda, SYNTHETIC_PERSON_ID } from '@massimiliano-dev/fse-fixtures';
import { injectCda } from '@massimiliano-dev/fse-pdf';
import { describe, expect, it } from 'vitest';
import {
  FseGatewayClient,
  FseValidationError,
  RsaPemJwtSigner,
  type FseRequestContext,
} from '../src/index.js';

/**
 * Smoke test against the real gateway, PRE environment only, with the SYNTHETIC CDA. Opt-in:
 *   FSE_GATEWAY_ENV=pre FSE_SIGN_CERT_FILE=… FSE_SIGN_KEY_FILE=… FSE_TLS_CERT_FILE=… FSE_TLS_KEY_FILE=…
 *   FSE_CONTEXT_FILE=context.json pnpm test:gateway
 * Success means "the gateway authenticated us and answered": the synthetic document is expected to be
 * rejected by the schematron, which is fine.
 */
const env = process.env;
const enabled = env.FSE_GATEWAY_ENV === 'pre';

describe.skipIf(!enabled)('FSE gateway (PRE) smoke test', () => {
  it('authenticates and gets a validation answer for the synthetic CDA', async () => {
    const read = (name: string) => readFileSync(env[name] ?? '');
    const ctx = JSON.parse(read('FSE_CONTEXT_FILE').toString('utf8')) as Omit<
      FseRequestContext,
      'personId' | 'resourceHl7Type'
    > & {
      application: { id: string; vendor: string; version: string };
    };
    const client = new FseGatewayClient({
      environment: 'pre',
      tls: {
        cert: read('FSE_TLS_CERT_FILE'),
        key: read('FSE_TLS_KEY_FILE'),
        ...(env.FSE_TLS_KEY_PASSPHRASE ? { passphrase: env.FSE_TLS_KEY_PASSPHRASE } : {}),
      },
      signer: RsaPemJwtSigner.fromPem({
        certificatePem: read('FSE_SIGN_CERT_FILE'),
        privateKeyPem: read('FSE_SIGN_KEY_FILE'),
        ...(env.FSE_SIGN_KEY_PASSPHRASE ? { passphrase: env.FSE_SIGN_KEY_PASSPHRASE } : {}),
      }),
      application: ctx.application,
    });
    const pdf = await injectCda(makeTestPdf(), readSyntheticCda());
    try {
      const outcome = await client
        .validate({
          pdf,
          requestBody: { activity: 'VERIFICA' },
          context: {
            ...ctx,
            personId: SYNTHETIC_PERSON_ID,
            resourceHl7Type: "('11488-4^^2.16.840.1.113883.6.1')",
          },
        })
        .catch((error: unknown) => error);
      if (outcome instanceof Error) expect(outcome).toBeInstanceOf(FseValidationError);
    } finally {
      await client.close();
    }
  });
});
