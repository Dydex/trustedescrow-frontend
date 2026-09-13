import { describe, expect, it } from 'vitest';
import { generateCode, releaseCodeHash } from '@/sdk/code';
import { envelopeAad, fromBase64, keyFromPrfOutput, openEnvelope, PBKDF2_ITERATIONS, PASSWORD_CREDENTIAL_ID, sealCode } from '@/sdk/vault';

const draftId = '7f1c2a58-7f7e-4a36-9d8a-2d3b0c1e9f10';

describe('password envelopes', async () => {
  const code = generateCode();
  const hash = await releaseCodeHash(code);
  const envelope = await sealCode({ code, draftId, releaseCodeHash: hash, secret: { kind: 'password', password: 'correct horse battery staple' } });

  it('meets the backend envelope rules', () => {
    // trustedescrow-backend src/modules/vault-envelope.ts
    expect(envelope.alg).toBe('A256GCM');
    expect(envelope.credentialId).toBe(PASSWORD_CREDENTIAL_ID);
    expect(fromBase64(envelope.iv)).toHaveLength(12);
    expect(fromBase64(envelope.ciphertext)).toHaveLength(32);
    expect(envelope.kdf.name).toBe('pbkdf2-sha256');
    expect(fromBase64(envelope.kdf.salt).length).toBeGreaterThanOrEqual(16);
    if (envelope.kdf.name === 'pbkdf2-sha256') expect(envelope.kdf.iterations).toBeGreaterThanOrEqual(600_000);
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });

  it('never contains the plaintext code', () => {
    const json = JSON.stringify(envelope);
    expect(json).not.toContain(code);
    expect(new TextDecoder('latin1').decode(fromBase64(envelope.ciphertext))).not.toContain(code);
  });

  it('opens with the right password', async () => {
    const opened = await openEnvelope({ envelope, draftId, releaseCodeHash: hash, secret: { kind: 'password', password: 'correct horse battery staple' } });
    expect(opened).toBe(code);
  });

  it('refuses the wrong password', async () => {
    await expect(openEnvelope({ envelope, draftId, releaseCodeHash: hash, secret: { kind: 'password', password: 'wrong' } })).rejects.toThrow(/Wrong password/);
  });

  it('is bound to its draft', async () => {
    await expect(
      openEnvelope({ envelope, draftId: '00000000-0000-4000-8000-000000000000', releaseCodeHash: hash, secret: { kind: 'password', password: 'correct horse battery staple' } }),
    ).rejects.toThrow();
  });
});

describe('passkey PRF key derivation', () => {
  it('derives a usable AES key from PRF output', async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const k1 = await keyFromPrfOutput(prf, salt);
    const k2 = await keyFromPrfOutput(prf, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = envelopeAad(draftId, 'ab'.repeat(32));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, k1, new TextEncoder().encode('K7M29XQF4TBNR3WD'));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, k2, ct);
    expect(new TextDecoder().decode(pt)).toBe('K7M29XQF4TBNR3WD');
  });
});

it('refuses to seal a code that does not match its hash', async () => {
  await expect(
    sealCode({ code: 'K7M29XQF4TBNR3WD', draftId, releaseCodeHash: 'ab'.repeat(32), secret: { kind: 'password', password: 'x' } }),
  ).rejects.toThrow(/does not match/);
});
