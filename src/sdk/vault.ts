import { codeBytes, isCanonical, releaseCodeHash } from './code';

/**
 * Client side of the encrypted code vault (ARCHITECTURE §6).
 *
 * The buyer's device encrypts the 16-byte canonical code under a key derived from the
 * buyer's own credential and uploads only the envelope. The server has no key.
 *
 * - Passkey: the WebAuthn PRF extension yields 32 secret bytes per (credential, salt);
 *   HKDF turns them into an AES-256-GCM key. A synced passkey is what recovers the
 *   code on a new device.
 * - Password: PBKDF2-SHA256 at 600k iterations, the backend's floor. The password
 *   never leaves the device.
 *
 * The AEAD additional data binds each envelope to its draft and committed hash, so an
 * envelope cannot be replayed onto a different order.
 */

export const PBKDF2_ITERATIONS = 600_000;
const PRF_HKDF_INFO = 'trustescrow vault v1 aes-256-gcm';

export type KdfParams =
  | { name: 'webauthn-prf'; salt: string }
  | { name: 'pbkdf2-sha256'; salt: string; iterations: number }
  | { name: 'argon2id'; salt: string; memoryKiB: number; iterations: number; parallelism: number };

export interface VaultEnvelope {
  credentialId: string;
  alg: 'A256GCM' | 'XC20P';
  kdf: KdfParams;
  iv: string;
  ciphertext: string;
}

export type VaultSecret = { kind: 'password'; password: string } | { kind: 'passkey'; credentialId: string; rpId?: string };

export class VaultError extends Error {}

export function envelopeAad(draftId: string, releaseCodeHashHex: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`trustescrow:vault:v1:${draftId}:${releaseCodeHashHex.toLowerCase()}`);
}

export const PASSWORD_CREDENTIAL_ID = 'password:v1';
export const passkeyCredentialId = (rawIdB64url: string) => `passkey:${rawIdB64url}`;

// --- encoding -------------------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const std = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const s = atob(padded);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const buf = (b: Uint8Array) => b as BufferSource;
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// --- key derivation ---------------------------------------------------------------

export async function derivePasswordKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  if (iterations < PBKDF2_ITERATIONS) throw new VaultError(`PBKDF2 needs at least ${PBKDF2_ITERATIONS} iterations`);
  const material = await crypto.subtle.importKey('raw', buf(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function keyFromPrfOutput(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', buf(prfOutput), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(new TextEncoder().encode(PRF_HKDF_INFO)) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// --- passkeys ---------------------------------------------------------------------

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined' && !!navigator.credentials;
}

/**
 * Creates a discoverable passkey used only to derive the vault key. It is not a login
 * credential and nothing about it is verified by the server. Returns the raw id
 * (base64url), or throws if the authenticator does not support PRF.
 */
export async function createVaultPasskey(opts: { rpId?: string; userName: string }): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'TrustEscrow code vault', ...(opts.rpId ? { id: opts.rpId } : {}) },
      user: { id: buf(random(16)), name: opts.userName, displayName: `TrustEscrow vault (${opts.userName.slice(0, 6)}…)` },
      challenge: buf(random(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new VaultError('Passkey creation was cancelled');
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } };
  if (!ext.prf?.enabled) throw new VaultError('This passkey provider does not support the PRF extension. Use a password instead.');
  return toBase64Url(new Uint8Array(cred.rawId));
}

async function prfOutput(rawIdB64url: string, salt: Uint8Array, rpId?: string): Promise<Uint8Array> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: buf(random(32)),
      allowCredentials: [{ type: 'public-key', id: buf(fromBase64(rawIdB64url)) }],
      userVerification: 'required',
      ...(rpId ? { rpId } : {}),
      extensions: { prf: { eval: { first: buf(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new VaultError('Passkey prompt was cancelled');
  const ext = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const first = ext.prf?.results?.first;
  if (!first) throw new VaultError('The passkey did not return a PRF result. Try a different passkey provider, or use your password.');
  return new Uint8Array(first);
}

// --- seal and open ------------------------------------------------------------------

async function encrypt(key: CryptoKey, code: string, aad: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad) }, key, buf(codeBytes(code)));
  return { iv, ciphertext: new Uint8Array(ct) };
}

export async function sealCode(params: {
  code: string;
  draftId: string;
  releaseCodeHash: string;
  secret: VaultSecret;
}): Promise<VaultEnvelope> {
  if (!isCanonical(params.code)) throw new VaultError('Only a canonical code can be sealed');
  if ((await releaseCodeHash(params.code)) !== params.releaseCodeHash.toLowerCase()) throw new VaultError('Code does not match its hash');
  const aad = envelopeAad(params.draftId, params.releaseCodeHash);
  const salt = random(32);

  if (params.secret.kind === 'password') {
    const key = await derivePasswordKey(params.secret.password, salt);
    const { iv, ciphertext } = await encrypt(key, params.code, aad);
    return {
      credentialId: PASSWORD_CREDENTIAL_ID,
      alg: 'A256GCM',
      kdf: { name: 'pbkdf2-sha256', salt: toBase64(salt), iterations: PBKDF2_ITERATIONS },
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
    };
  }

  const key = await keyFromPrfOutput(await prfOutput(params.secret.credentialId, salt, params.secret.rpId), salt);
  const { iv, ciphertext } = await encrypt(key, params.code, aad);
  return {
    credentialId: passkeyCredentialId(params.secret.credentialId),
    alg: 'A256GCM',
    kdf: { name: 'webauthn-prf', salt: toBase64(salt) },
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

/** Decrypts an envelope and checks the result against the committed on-chain hash. */
export async function openEnvelope(params: {
  envelope: VaultEnvelope;
  draftId: string;
  releaseCodeHash: string;
  secret: VaultSecret;
}): Promise<string> {
  const { envelope } = params;
  if (envelope.alg !== 'A256GCM') throw new VaultError(`Unsupported cipher ${envelope.alg}`);
  const salt = fromBase64(envelope.kdf.salt);

  let key: CryptoKey;
  if (envelope.kdf.name === 'pbkdf2-sha256') {
    if (params.secret.kind !== 'password') throw new VaultError('This envelope is opened with a password');
    key = await derivePasswordKey(params.secret.password, salt, envelope.kdf.iterations);
  } else if (envelope.kdf.name === 'webauthn-prf') {
    if (params.secret.kind !== 'passkey') throw new VaultError('This envelope is opened with a passkey');
    key = await keyFromPrfOutput(await prfOutput(params.secret.credentialId, salt, params.secret.rpId), salt);
  } else {
    throw new VaultError('Argon2id envelopes are not supported in this browser build');
  }

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(fromBase64(envelope.iv)), additionalData: buf(envelopeAad(params.draftId, params.releaseCodeHash)) },
      key,
      buf(fromBase64(envelope.ciphertext)),
    );
  } catch {
    throw new VaultError(params.secret.kind === 'password' ? 'Wrong password' : 'This passkey cannot open the code');
  }
  const code = new TextDecoder().decode(plain);
  if (!isCanonical(code) || (await releaseCodeHash(code)) !== params.releaseCodeHash.toLowerCase()) {
    throw new VaultError('The decrypted code does not match the escrow. Do not use it.');
  }
  return code;
}

/** The passkey raw id inside a `passkey:` credential id, if it is one. */
export function passkeyRawId(credentialId: string): string | null {
  return credentialId.startsWith('passkey:') ? credentialId.slice('passkey:'.length) : null;
}
