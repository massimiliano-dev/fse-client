import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestCertificate, makeTestPdf, readSyntheticCda } from '@massimiliano-dev/fse-fixtures';
import type { CliIo } from '../src/index.js';

/** Captures CLI output. */
export function captureIo(
  cwd: string,
  env: Record<string, string> = {},
): CliIo & { out: string; err: string } {
  const io = {
    out: '',
    err: '',
    stdout: (text: string) => {
      io.out += text;
    },
    stderr: (text: string) => {
      io.err += text;
    },
    env,
    cwd,
  };
  return io;
}

/** A temporary workspace with synthetic CDA, PDF, context file and throwaway credentials (mode 600). */
export async function makeWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'fse-cli-test-'));
  const sign = createTestCertificate({ commonName: 'SYNTHETIC-SIGN-CN' });
  const tls = createTestCertificate({ commonName: 'SYNTHETIC-TLS-CN' });
  const files: Record<string, string | Uint8Array> = {
    'cda.xml': readSyntheticCda(),
    'document.pdf': makeTestPdf(),
    'sign-cert.pem': sign.certificatePem,
    'sign-key.pem': sign.privateKeyPem,
    'tls-cert.pem': tls.certificatePem,
    'tls-key.pem': tls.privateKeyPem,
    'context.json': JSON.stringify({
      subject: 'OPERAT00X00X000Z^^^&2.16.840.1.113883.2.9.4.3.2&ISO',
      subjectRole: 'AAS',
      subjectOrganizationId: '999',
      subjectOrganization: 'Regione Sintetica',
      locality: 'STRUTTURA SINTETICA^^^^^&2.16.840.1.113883.2.9.4.1.3&ISO^^^^999999999999',
      patientConsent: true,
      application: { id: 'FSECLIENT-TEST', vendor: 'SYNTHETIC VENDOR', version: '0.0.0' },
    }),
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
    if (name.endsWith('key.pem')) await chmod(join(dir, name), 0o600);
  }
  const env = {
    FSE_SIGN_CERT_FILE: 'sign-cert.pem',
    FSE_SIGN_KEY_FILE: 'sign-key.pem',
    FSE_TLS_CERT_FILE: 'tls-cert.pem',
    FSE_TLS_KEY_FILE: 'tls-key.pem',
    FSE_CONTEXT_FILE: 'context.json',
  };
  return { dir, env, sign, tls, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
