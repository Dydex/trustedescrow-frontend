import { describe, expect, it } from 'vitest';
import {
  CODE_LEN,
  candidateCodes,
  containsDeliveryCode,
  display,
  encode,
  fromHex,
  generateCode,
  InvalidCodeError,
  isCanonical,
  matchesCommittedHash,
  normalise,
  releaseCodeHash,
} from '@/sdk/code';
import vectors from './fixtures/delivery-codes.json';

// Vectors copied from trustedescrow-contract/test-vectors/delivery-codes.json. A client
// that passes them produces the same bytes the contract checks.

describe('delivery code vectors', () => {
  it('uses the contract alphabet', () => {
    expect(vectors.alphabet).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  });

  for (const v of vectors.encoding) {
    it(`encodes ${v.entropy_hex}`, async () => {
      const code = encode(fromHex(v.entropy_hex));
      expect(code).toBe(v.code);
      expect(display(code)).toBe(v.display);
      expect(await releaseCodeHash(code)).toBe(v.sha256_hex);
    });
  }

  for (const v of vectors.normalisation) {
    it(`normalises ${JSON.stringify(v.input)}`, async () => {
      if ('error' in v && v.error) {
        let err: unknown;
        try {
          normalise(v.input);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(InvalidCodeError);
        expect((err as InvalidCodeError).detail.kind).toBe(v.error);
      } else {
        const canonical = normalise(v.input);
        expect(canonical).toBe(v.canonical);
        expect(await releaseCodeHash(canonical)).toBe(v.sha256_hex);
      }
    });
  }
});

describe('generation', () => {
  it('produces canonical 16-character codes that round-trip through display', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LEN);
      expect(isCanonical(code)).toBe(true);
      expect(normalise(display(code))).toBe(code);
    }
  });

  it('never repeats in practice', () => {
    const seen = new Set(Array.from({ length: 1000 }, generateCode));
    expect(seen.size).toBe(1000);
  });
});

describe('matching and leak detection', () => {
  it('matches typed and spoken forms against the committed hash', async () => {
    const hash = await releaseCodeHash('K7M29XQF4TBNR3WD');
    expect(await matchesCommittedHash('k7m2 9xqf 4tbn r3wd', hash)).toBe(true);
    expect(await matchesCommittedHash('K7M2-9XQF-4TBN-R3WE', hash)).toBe(false);
    expect(await matchesCommittedHash('not a code', hash)).toBe(false);
  });

  it('finds a code embedded in a chat message', async () => {
    const hash = await releaseCodeHash('K7M29XQF4TBNR3WD');
    expect(await containsDeliveryCode('here you go: k7m2-9xqf-4tbn-r3wd thanks', hash)).toBe(true);
    expect(await containsDeliveryCode('the parcel is on its way', hash)).toBe(false);
    expect(candidateCodes('K7M2-9XQF-4TBN-R3WD')).toContain('K7M29XQF4TBNR3WD');
  });
});
