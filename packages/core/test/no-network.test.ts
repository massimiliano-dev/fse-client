import tls from 'node:tls';
import { describe, expect, it } from 'vitest';

describe('unit-test network guard', () => {
  it('refuses connections to the real gateway host', () => {
    expect(() => tls.connect({ host: 'modipa-val.fse.salute.gov.it', port: 443 })).toThrow(
      /blocked in unit tests/,
    );
  });
});
