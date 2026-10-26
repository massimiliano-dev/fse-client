import { describe, expect, it, vi } from 'vitest';
import { OptionalDependencyMissingError, SaxonSchematronValidator, UnsafeXmlError } from '../src/index.js';
import { importSaxon } from '../src/schematron.js';

describe('SaxonSchematronValidator', () => {
  it('explains that saxon-js is an optional peer dependency when it is missing', async () => {
    const validator = new SaxonSchematronValidator({
      schematronName: 'test',
      sef: '{}',
      loadSaxon: () => importSaxon('saxon-js-not-installed-for-this-test'),
    });
    await expect(validator.validate('<ClinicalDocument xmlns="urn:hl7-org:v3"/>')).rejects.toBeInstanceOf(
      OptionalDependencyMissingError,
    );
  });

  it('rejects unsafe XML before loading SaxonJS', async () => {
    const loadSaxon = vi.fn();
    const validator = new SaxonSchematronValidator({ schematronName: 'test', sef: '{}', loadSaxon });
    await expect(validator.validate('<!DOCTYPE x [<!ENTITY y "z">]><x>&y;</x>')).rejects.toBeInstanceOf(
      UnsafeXmlError,
    );
    expect(loadSaxon).not.toHaveBeenCalled();
  });
});
