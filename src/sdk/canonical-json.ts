import { sha256, toHex } from './code';

/**
 * RFC 8785 (JSON Canonicalization Scheme). Must produce the same bytes as the
 * backend's `src/lib/canonical-json.ts`: `terms_hash = sha256(canonical_json(terms))`
 * is committed on-chain at creation and recomputed by the arbitrator console.
 * Object keys sorted by UTF-16 code unit, no whitespace, numbers in ECMAScript
 * shortest form, non-finite numbers rejected.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export async function termsHashHex(terms: unknown): Promise<string> {
  return toHex(await sha256(canonicalJson(terms)));
}

/**
 * Verifies bytes the backend says are canonical, and hashes them locally. The
 * buyer commits this hash on-chain, so it is never taken from the server's word.
 */
export async function verifyCanonicalTerms<T>(canonical: string): Promise<{ terms: T; termsHash: string }> {
  const terms = JSON.parse(canonical) as T;
  if (canonicalJson(terms) !== canonical) {
    throw new Error('The terms from the server are not in canonical form. Refusing to hash them.');
  }
  return { terms, termsHash: toHex(await sha256(canonical)) };
}
