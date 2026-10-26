#!/usr/bin/env node
/**
 * Fails if the repository contains secrets or personal health data:
 * - key/certificate/keystore files and .env files;
 * - PEM private keys or certificates, JWTs, Italian fiscal codes (codice fiscale) in text files.
 *
 * Dependency-free on purpose. A line can opt out with the marker "check-secrets: allow" (use it only for
 * documented, obviously fake values). Run with `pnpm check:secrets`; CI runs it on every push.
 */
import { closeSync, fstatSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'vendor']);
const ALLOW_MARKER = 'check-secrets: ' + 'allow';

const FORBIDDEN_FILE = /\.(pem|key|p12|pfx|crt|cer|der|csr|jks|keystore)$/i;
const ENV_FILE = /^\.env(\..+)?$/;

// Patterns are assembled from parts so that this file does not match itself.
const DASHES = '-'.repeat(5);
const OMO = '[0-9LMNPQRSTUV]';
const RULES = [
  { name: 'PEM private key', re: new RegExp(`${DASHES}BEGIN [A-Z ]*PRIVATE KEY${DASHES}`) },
  { name: 'PEM certificate', re: new RegExp(`${DASHES}BEGIN (?:CERTIFICATE|CERTIFICATE REQUEST)${DASHES}`) },
  {
    name: 'JWT',
    re: new RegExp(
      '\\b' + 'eyJ' + '[A-Za-z0-9_-]{10,}\\.' + 'eyJ' + '[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
    ),
  },
  {
    name: 'codice fiscale',
    re: new RegExp(
      `(?<![A-Za-z0-9])[A-Z]{6}${OMO}{2}[ABCDEHLMPRST]${OMO}{2}[A-Z]${OMO}{3}[A-Z](?![A-Za-z0-9])`,
    ),
  },
];

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (FORBIDDEN_FILE.test(entry.name)) findings.push(`${rel}: forbidden file type (keys/certificates)`);
    if (ENV_FILE.test(entry.name) && entry.name !== '.env.example') findings.push(`${rel}: .env file`);
    // Stat and read through one descriptor, so the file cannot change between the two (TOCTOU).
    let buf;
    const fd = openSync(path, 'r');
    try {
      if (fstatSync(fd).size > 5 * 1024 * 1024) continue;
      buf = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
    if (buf.includes(0)) continue; // binary
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(ALLOW_MARKER)) return;
      for (const rule of RULES) {
        if (rule.re.test(line)) findings.push(`${rel}:${i + 1}: possible ${rule.name}`);
      }
    });
  }
}

walk(root);
if (findings.length > 0) {
  console.error('check-secrets: found possible secrets or personal data (values not shown):');
  for (const f of findings) console.error(`  ${f}`);
  console.error(`\nRemove them. For documented fake values only, add "${ALLOW_MARKER}" on the same line.`);
  process.exit(1);
}
console.log('check-secrets: no secrets or fiscal codes found');
