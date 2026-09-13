import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, termsHashHex, verifyCanonicalTerms } from '@/sdk/canonical-json';

describe('canonicalJson (RFC 8785)', () => {
  it('sorts keys and removes whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 'x', null], c: true } })).toBe('{"a":{"c":true,"d":[1,"x",null]},"b":1}');
  });

  it('sorts keys by UTF-16 code unit', () => {
    expect(canonicalJson({ 'é': 1, z: 2, A: 3, '😀': 4 })).toBe('{"A":3,"z":2,"é":1,"😀":4}');
  });

  it('writes numbers in shortest form and rejects non-finite ones', () => {
    expect(canonicalJson([1e21, 0.1, -0, 3600])).toBe('[1e+21,0.1,0,3600]');
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });

  it('drops undefined fields', () => {
    expect(canonicalJson({ a: undefined, b: 'x' })).toBe('{"b":"x"}');
  });

  it('hashes the canonical bytes', async () => {
    const terms = { version: 1, amount: '250000000', item: { title: 'Phone', description: '' } };
    const expected = createHash('sha256').update(canonicalJson(terms), 'utf8').digest('hex');
    expect(await termsHashHex(terms)).toBe(expected);
  });
});

describe('verifyCanonicalTerms', () => {
  it('accepts canonical bytes and hashes them locally', async () => {
    const canonical = canonicalJson({ ref: 'r', amount: '1' });
    const { terms, termsHash } = await verifyCanonicalTerms<{ ref: string }>(canonical);
    expect(terms.ref).toBe('r');
    expect(termsHash).toBe(createHash('sha256').update(canonical).digest('hex'));
  });

  it('refuses bytes that are not canonical', async () => {
    await expect(verifyCanonicalTerms('{"b":1,"a":2}')).rejects.toThrow(/canonical/);
    await expect(verifyCanonicalTerms('{"a": 2}')).rejects.toThrow(/canonical/);
  });
});
