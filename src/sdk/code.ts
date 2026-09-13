/**
 * Delivery code (ARCHITECTURE §4 "The delivery code").
 *
 * 80 bits of entropy written as 16 Crockford base32 characters, displayed as
 * `K7M2-9XQF-4TBN-R3WD`. The escrow stores sha256 of the 16 canonical ASCII
 * characters. This mirrors `crates/code` in the contract repo and must pass the
 * shared vectors in `test-vectors/delivery-codes.json`.
 *
 * Generation happens on the buyer's device only. Never call this from server code.
 */

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ENTROPY_BYTES = 10;
export const CODE_LEN = 16;

const ALIASES: Record<string, string> = { I: '1', L: '1', O: '0' };
const ASCII_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

export type CodeError = { kind: 'character'; char: string } | { kind: 'length'; length: number };

export class InvalidCodeError extends Error {
  constructor(readonly detail: CodeError) {
    super(
      detail.kind === 'character'
        ? `"${detail.char}" is not a delivery code character`
        : `A delivery code has ${CODE_LEN} characters, not ${detail.length}`,
    );
  }
}

/** Encode 80 bits of entropy as a canonical code, most significant bits first. */
export function encode(entropy: Uint8Array): string {
  if (entropy.length !== ENTROPY_BYTES) throw new Error(`entropy must be ${ENTROPY_BYTES} bytes`);
  let bits = 0n;
  for (const byte of entropy) bits = (bits << 8n) | BigInt(byte);
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    const shift = BigInt(5 * (CODE_LEN - 1 - i));
    code += ALPHABET[Number((bits >> shift) & 0x1fn)];
  }
  return code;
}

/** A fresh code from the platform CSPRNG. */
export function generateCode(): string {
  return encode(crypto.getRandomValues(new Uint8Array(ENTROPY_BYTES)));
}

/** Four groups of four separated by hyphens. */
export function display(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/**
 * Canonicalise what a person typed, read aloud or scanned: strip ASCII whitespace
 * and hyphens, uppercase, map I/L to 1 and O to 0. Characters are checked before
 * length, so the first bad character is always the one reported.
 */
export function normalise(input: string): string {
  let out = '';
  for (const c of input) {
    if (ASCII_WHITESPACE.has(c) || c === '-') continue;
    const upper = c.length === 1 && c.charCodeAt(0) < 0x80 ? c.toUpperCase() : c;
    const canonical = ALIASES[upper] ?? upper;
    if (!ALPHABET.includes(canonical) || canonical.length !== 1) {
      throw new InvalidCodeError({ kind: 'character', char: c });
    }
    out += canonical;
  }
  if (out.length !== CODE_LEN) throw new InvalidCodeError({ kind: 'length', length: out.length });
  return out;
}

/** Like `normalise`, but returns null instead of throwing. */
export function tryNormalise(input: string): string | null {
  try {
    return normalise(input);
  } catch {
    return null;
  }
}

export function isCanonical(code: string): boolean {
  return code.length === CODE_LEN && [...code].every((c) => ALPHABET.includes(c));
}

/** The 16 ASCII bytes the contract hashes and `release_with_code` takes. */
export function codeBytes(canonical: string): Uint8Array {
  if (!isCanonical(canonical)) throw new Error('code is not canonical; normalise it first');
  return new TextEncoder().encode(canonical);
}

/** `release_code_hash` for a canonical code, as lowercase hex. */
export async function releaseCodeHash(canonical: string): Promise<string> {
  return toHex(await sha256(codeBytes(canonical)));
}

/** Whether `input` is the code committed as `releaseCodeHashHex`. Hashes locally; nothing is sent anywhere. */
export async function matchesCommittedHash(input: string, releaseCodeHashHex: string): Promise<boolean> {
  const canonical = tryNormalise(input);
  if (!canonical) return false;
  return (await releaseCodeHash(canonical)) === releaseCodeHashHex.toLowerCase();
}

/**
 * Every 16-symbol window of Crockford characters in `text`. Used to warn before a
 * message containing the code leaves the device; false candidates are harmless
 * because they must also match the committed hash.
 */
export function candidateCodes(text: string): string[] {
  const seen = new Set<string>();
  for (const chunk of text.toUpperCase().split(/[^0-9A-Z\s-]+/)) {
    let symbols = '';
    for (const c of chunk) {
      if (ASCII_WHITESPACE.has(c) || c === '-' || /\s/.test(c)) continue;
      const mapped = ALIASES[c] ?? c;
      if (ALPHABET.includes(mapped)) symbols += mapped;
    }
    for (let i = 0; i + CODE_LEN <= symbols.length; i++) seen.add(symbols.slice(i, i + CODE_LEN));
  }
  return [...seen];
}

export async function containsDeliveryCode(text: string, releaseCodeHashHex: string): Promise<boolean> {
  const target = releaseCodeHashHex.toLowerCase();
  for (const candidate of candidateCodes(text)) {
    if ((await releaseCodeHash(candidate)) === target) return true;
  }
  return false;
}

/** Shape check with no hash: something that looks like a grouped code. */
export function looksLikeCode(text: string): boolean {
  return /[0-9A-Za-z]{4}[-\s][0-9A-Za-z]{4}[-\s][0-9A-Za-z]{4}[-\s][0-9A-Za-z]{4}/.test(text) || /\b[0-9A-Za-z]{16}\b/.test(text);
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
