import {
  createTestCertificate,
  SYNTHETIC_PERSON_ID,
  type TestCertificate,
} from '@massimiliano-dev/fse-fixtures';
import type { FseApplicationInfo, FseRequestContext } from '../src/index.js';

let cached: { signature: TestCertificate; tls: TestCertificate } | undefined;

/** Two throwaway in-memory certificates (signature + TLS client), generated once per test file. */
export function testCertificates(): { signature: TestCertificate; tls: TestCertificate } {
  cached ??= {
    signature: createTestCertificate({ commonName: 'SYNTHETIC-SIGN-CN' }),
    tls: createTestCertificate({ commonName: 'SYNTHETIC-TLS-CN' }),
  };
  return cached;
}

/** Synthetic operator/patient context. All values are fake. */
export const context: FseRequestContext = {
  subject: SYNTHETIC_PERSON_ID,
  subjectRole: 'AAS',
  subjectOrganizationId: '999',
  subjectOrganization: 'Regione Sintetica',
  locality: 'STRUTTURA SINTETICA^^^^^&2.16.840.1.113883.2.9.4.1.3&ISO^^^^999999999999',
  personId: SYNTHETIC_PERSON_ID,
  patientConsent: true,
  resourceHl7Type: "('11488-4^^2.16.840.1.113883.6.1')",
};

export const application: FseApplicationInfo = {
  id: 'FSECLIENT-TEST',
  vendor: 'SYNTHETIC VENDOR',
  version: '0.0.0',
};

/** Decodes a JWT segment. */
export function decodeSegment(token: string, index: 0 | 1): Record<string, unknown> {
  const part = token.split('.')[index];
  return JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
}
