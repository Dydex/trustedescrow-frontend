import { sha256, toHex } from './code';
import type { ProofKind } from './types';

/**
 * Client-side mirror of the contract's `validate_uri`, so a bad link is caught
 * before anyone pays a fee. The contract remains the authority.
 */
export const MAX_URI_LEN = 256;
const SCHEMES = ['https://', 'ipfs://', 'ar://'];

export function uriProblem(kind: ProofKind, uri: string): string | null {
  if (uri.length === 0) return kind === 'Attestation' ? null : 'A link is required for this kind of proof.';
  const bytes = new TextEncoder().encode(uri);
  if (bytes.length > MAX_URI_LEN) return `The link is ${bytes.length} bytes; the limit is ${MAX_URI_LEN}.`;
  if (![...bytes].every((b) => b >= 0x21 && b <= 0x7e)) return 'The link must be plain ASCII with no spaces.';
  if (!SCHEMES.some((s) => uri.length > s.length && uri.startsWith(s))) return 'The link must start with https://, ipfs:// or ar://.';
  return null;
}

/** sha256 of a file the seller delivered or photographed, computed on this device. */
export async function hashFile(file: Blob): Promise<string> {
  return toHex(await sha256(new Uint8Array(await file.arrayBuffer())));
}

/** An attestation commits to a statement held off-chain: its exact UTF-8 bytes are hashed. */
export async function hashStatement(statement: string): Promise<string> {
  return toHex(await sha256(statement));
}

export const PROOF_KIND_HELP: Record<ProofKind, { label: string; hint: string }> = {
  Tracking: {
    label: 'Carrier tracking',
    hint: 'A tracking link from the carrier, and a photo of the waybill or receipt. The photo is hashed on your device.',
  },
  Content: {
    label: 'Digital content',
    hint: 'A link to the delivered file and the file itself. The buyer can hash what they received and compare.',
  },
  Attestation: {
    label: 'Seller statement',
    hint: 'Your written statement of what was delivered. This is the weakest kind of proof.',
  },
};
