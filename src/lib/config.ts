/**
 * Build-time configuration. Every value is public and compiled into the bundle.
 * `process.env.NEXT_PUBLIC_*` must be referenced literally for Next.js to inline it.
 *
 * The factory id, pinned escrow WASM hash and network are trust anchors: they come
 * from this build and are never taken from the backend.
 */

export interface Rail {
  id: string;
  tokenAddress: string;
  displaySymbol: string;
  decimals: number;
}

function parseRails(raw: string | undefined): Rail[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Rail =>
        !!r &&
        typeof r.id === 'string' &&
        typeof r.tokenAddress === 'string' &&
        typeof r.displaySymbol === 'string' &&
        Number.isInteger(r.decimals),
    );
  } catch {
    return [];
  }
}

export const config = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet',
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  factoryContractId: process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID ?? '',
  escrowWasmHash: (process.env.NEXT_PUBLIC_ESCROW_WASM_HASH ?? '').toLowerCase(),
  rails: parseRails(process.env.NEXT_PUBLIC_RAILS),
  webauthnRpId: process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID || undefined,
} as const;

/** What is missing before escrows can be created from this build. */
export function configProblems(): string[] {
  const problems: string[] = [];
  if (!config.factoryContractId) problems.push('NEXT_PUBLIC_FACTORY_CONTRACT_ID is not set');
  if (!/^[0-9a-f]{64}$/.test(config.escrowWasmHash)) problems.push('NEXT_PUBLIC_ESCROW_WASM_HASH is not a 32-byte hex hash');
  if (config.rails.length === 0) problems.push('NEXT_PUBLIC_RAILS has no settlement rails');
  return problems;
}

export function railForToken(token: string): Rail | undefined {
  return config.rails.find((r) => r.tokenAddress === token);
}

export function railById(id: string): Rail | undefined {
  return config.rails.find((r) => r.id === id);
}

/** Decimals and symbol for a token, with a safe fallback for unknown tokens. */
export function tokenDisplay(token: string): { decimals: number; symbol: string; known: boolean } {
  const rail = railForToken(token);
  return rail ? { decimals: rail.decimals, symbol: rail.displaySymbol, known: true } : { decimals: 7, symbol: 'units', known: false };
}

export const explorerTxUrl = (hash: string) => `https://stellar.expert/explorer/${config.network === 'public' ? 'public' : 'testnet'}/tx/${hash}`;
export const explorerContractUrl = (id: string) =>
  `https://stellar.expert/explorer/${config.network === 'public' ? 'public' : 'testnet'}/contract/${id}`;
