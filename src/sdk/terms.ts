import type { EscrowSnapshot, Order } from './types';

/** The agreed terms as the backend's RFC 8785 canonical form carries them. */
export interface AgreedTerms {
  version: 1;
  ref: string;
  buyer: string;
  seller: string;
  rail: string;
  token: string;
  amount: string;
  item: { title: string; description: string };
  delivery: { method: 'in_person' | 'shipped' | 'digital' | 'service'; proofKind: 'Tracking' | 'Content' | 'Attestation'; carrier?: string; notes?: string };
  windows: { delivery: number; receipt: number; arbitration: number };
  fundingDeadline: number;
}

export const WINDOW_MIN_SECONDS = 3600;
export const WINDOW_MAX_SECONDS = 365 * 24 * 3600;

/** Evidence rules from ARCHITECTURE §7 "Proof kinds", matching the backend's validation. */
export const PROOF_KINDS_BY_METHOD = {
  in_person: ['Attestation', 'Tracking'],
  shipped: ['Tracking'],
  digital: ['Content'],
  service: ['Attestation'],
} as const;

/** The `Factory::create` order that commits exactly these terms. */
export function orderFromTerms(terms: AgreedTerms, termsHash: string, releaseCodeHash: string): Order {
  return {
    buyer: terms.buyer,
    seller: terms.seller,
    token: terms.token,
    amount: BigInt(terms.amount),
    termsHash: termsHash.toLowerCase(),
    releaseCodeHash: releaseCodeHash.toLowerCase(),
    fundingDeadline: terms.fundingDeadline,
    deliveryWindow: terms.windows.delivery,
    receiptWindow: terms.windows.receipt,
    arbitrationWindow: terms.windows.arbitration,
  };
}

/** Fields where a deployed escrow disagrees with the agreed terms. Empty means it commits them exactly. */
export function termsMismatches(terms: AgreedTerms, termsHash: string, s: EscrowSnapshot): string[] {
  const out: string[] = [];
  const check = (field: string, ok: boolean) => {
    if (!ok) out.push(field);
  };
  check('terms_hash', s.termsHash === termsHash.toLowerCase());
  check('buyer', s.buyer === terms.buyer);
  check('seller', s.seller === terms.seller);
  check('token', s.token === terms.token);
  check('amount', s.amount === BigInt(terms.amount));
  check('delivery_window', s.deliveryWindow === terms.windows.delivery);
  check('receipt_window', s.receiptWindow === terms.windows.receipt);
  check('arbitration_window', s.arbitrationWindow === terms.windows.arbitration);
  check('funding_deadline', s.fundingDeadline === terms.fundingDeadline);
  return out;
}

export const DELIVERY_METHOD_LABEL: Record<AgreedTerms['delivery']['method'], string> = {
  in_person: 'In-person handover',
  shipped: 'Shipped by carrier',
  digital: 'Digital delivery',
  service: 'Service',
};
