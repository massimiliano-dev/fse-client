import { describe, expect, it, vi } from 'vitest';
import { CompositeCdaValidator, type CdaValidator } from '../src/index.js';

const fixed = (valid: boolean, message: string): CdaValidator => ({
  validate: vi.fn(async () => ({
    valid,
    issues: valid ? [] : [{ severity: 'error' as const, source: 'xsd' as const, message }],
  })),
});

describe('CompositeCdaValidator', () => {
  it('stops at the first invalid result by default', async () => {
    const second = fixed(false, 'second');
    const result = await new CompositeCdaValidator([fixed(false, 'first'), second]).validate('<x/>');
    expect(result).toEqual({
      valid: false,
      issues: [{ severity: 'error', source: 'xsd', message: 'first' }],
    });
    expect(second.validate).not.toHaveBeenCalled();
  });

  it('can collect all issues', async () => {
    const result = await new CompositeCdaValidator([fixed(false, 'a'), fixed(true, ''), fixed(false, 'b')], {
      stopOnFirstInvalid: false,
    }).validate('<x/>');
    expect(result.issues.map((i) => i.message)).toEqual(['a', 'b']);
  });
});
