'use client';

/**
 * Wallet adapter. v1 signs with Freighter; everything else in the app talks to this
 * interface, so another wallet can be added without touching the flows.
 *
 * The wallet signs two things: SEP-53 messages for backend sign-in and step-up, and
 * Soroban transactions. Nothing else ever holds the user's key.
 */

export class WalletError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_installed' | 'rejected' | 'wrong_account' | 'wrong_network' | 'unknown',
  ) {
    super(message);
  }
}

export interface Wallet {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  /** Asks for access and returns the account address. */
  connect(): Promise<string>;
  /** The currently selected account, if the site already has access. */
  currentAddress(): Promise<string | null>;
  networkPassphrase(): Promise<string | null>;
  signTransaction(xdr: string, opts: { address: string; networkPassphrase: string }): Promise<string>;
  /** SEP-53 signature, base64. */
  signMessage(message: string, opts: { address: string; networkPassphrase: string }): Promise<string>;
}

function rejected(error: { message?: string; code?: number } | undefined, fallback: string): WalletError {
  const msg = error?.message ?? fallback;
  return new WalletError(/reject|declin|denied|cancel/i.test(msg) ? 'You declined the request in your wallet.' : msg, /reject|declin|denied|cancel/i.test(msg) ? 'rejected' : 'unknown');
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export const freighter: Wallet = {
  name: 'Freighter',

  async isAvailable() {
    const api = await import('@stellar/freighter-api');
    const res = await api.isConnected();
    return !!res.isConnected && !res.error;
  },

  async connect() {
    const api = await import('@stellar/freighter-api');
    const connected = await api.isConnected();
    if (!connected.isConnected) {
      throw new WalletError('Freighter is not installed. Install it from freighter.app, then reload this page.', 'not_installed');
    }
    const res = await api.requestAccess();
    if (res.error || !res.address) throw rejected(res.error, 'Freighter did not share an account');
    return res.address;
  },

  async currentAddress() {
    const api = await import('@stellar/freighter-api');
    const allowed = await api.isAllowed();
    if (!allowed.isAllowed) return null;
    const res = await api.getAddress();
    return res.error || !res.address ? null : res.address;
  },

  async networkPassphrase() {
    const api = await import('@stellar/freighter-api');
    const res = await api.getNetwork();
    return res.error ? null : res.networkPassphrase;
  },

  async signTransaction(xdr, { address, networkPassphrase }) {
    const api = await import('@stellar/freighter-api');
    const res = await api.signTransaction(xdr, { address, networkPassphrase });
    if (res.error || !res.signedTxXdr) throw rejected(res.error, 'Freighter did not sign the transaction');
    if (res.signerAddress && res.signerAddress !== address) {
      throw new WalletError(`Freighter signed with ${res.signerAddress}, not ${address}. Switch accounts and try again.`, 'wrong_account');
    }
    return res.signedTxXdr;
  },

  async signMessage(message, { address, networkPassphrase }) {
    const api = await import('@stellar/freighter-api');
    const res = await api.signMessage(message, { address, networkPassphrase });
    if (res.error || !res.signedMessage) throw rejected(res.error, 'Freighter did not sign the message');
    if (res.signerAddress && res.signerAddress !== address) {
      throw new WalletError(`Freighter signed with ${res.signerAddress}, not ${address}. Switch accounts and try again.`, 'wrong_account');
    }
    // Freighter v4+ returns base64; older builds return a Buffer.
    return typeof res.signedMessage === 'string' ? res.signedMessage : toBase64(new Uint8Array(res.signedMessage));
  },
};
