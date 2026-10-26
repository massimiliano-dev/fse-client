/**
 * FSE 2.0 gateway environments.
 *
 * Source: ministero-salute/it-fse-support, `doc/integrazione-gateway/README.md` §2 ("L'endpoint del sistema
 * di test è … / L'endpoint del sistema di produzione è …") and `openapi/gateway/swagger_gtw.yaml` (`servers`).
 * The base URL includes the major version and is also the required value of the JWT `aud` claim (§16.1).
 */
export const FSE_ENVIRONMENTS = {
  /** Test / pre-production ("VALIDAZIONE") environment. Use this one for development and accreditation. */
  pre: 'https://modipa-val.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1',
  /** Production. Real patients' data: only from an accredited, production-ready deployment. */
  prod: 'https://modipa.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1',
} as const;

/** Name of a known gateway environment. */
export type FseEnvironment = keyof typeof FSE_ENVIRONMENTS;

/** Returns true if `value` is a known environment name. */
export function isFseEnvironment(value: string): value is FseEnvironment {
  return Object.hasOwn(FSE_ENVIRONMENTS, value);
}

/**
 * Normalises and checks a gateway base URL: HTTPS only, no credentials, query or fragment, no trailing
 * slash.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError('Gateway base URL is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new TypeError('Gateway base URL must use https');
  if (url.username || url.password) throw new TypeError('Gateway base URL must not contain credentials');
  if (url.search || url.hash) throw new TypeError('Gateway base URL must not contain a query or fragment');
  return url.toString().replace(/\/+$/, '');
}
