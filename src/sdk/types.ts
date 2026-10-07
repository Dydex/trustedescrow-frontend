/** Contract types as the web app sees them (ARCHITECTURE §4 "State"). Times are unix seconds. */

export const STATES = ['Created', 'Funded', 'Delivered', 'Disputed', 'Released', 'Refunded', 'Cancelled'] as const;
export type EscrowState = (typeof STATES)[number];
export const TERMINAL_STATES: ReadonlySet<EscrowState> = new Set(['Released', 'Refunded', 'Cancelled']);

export type ProofKind = 'Tracking' | 'Content' | 'Attestation';
export type ReleasePath = 'Code' | 'Confirmation' | 'Arbitration';
export type RefundPath = 'SellerRefund' | 'DeliveryTimeout' | 'Arbitration' | 'ArbitrationTimeout';
export type DisputeOrigin = 'Buyer' | 'Seller' | 'ReceiptTimeout';
export type Outcome = 'Release' | 'Refund';

export interface Proof {
  kind: ProofKind;
  uri: string;
  /** sha256 of the referenced content, hex. */
  hash: string;
  submittedAt: number;
}

export interface Dispute {
  openedBy: DisputeOrigin;
  openedAt: number;
  fromState: EscrowState;
  deadline: number;
  statementHash: string | null;
  rulingHash: string | null;
}

export type Settlement =
  | { status: 'Open' }
  | { status: 'Released'; path: ReleasePath }
  | { status: 'Refunded'; path: RefundPath };

/** Live contract storage for one escrow, from a simulated `get`. Never from a cache. */
export interface EscrowSnapshot {
  contractId: string;
  buyer: string;
  seller: string;
  arbitrator: string;
  token: string;
  /** i128 base units. */
  amount: bigint;
  feeBps: number;
  feeRecipient: string;
  unsweptFee: bigint;
  termsHash: string;
  salt: string;
  releaseCodeHash: string;
  state: EscrowState;
  createdAt: number;
  fundingDeadline: number;
  deliveryWindow: number;
  receiptWindow: number;
  arbitrationWindow: number;
  /** 0 until funded. */
  fundedAt: number;
  /** 0 until funded. */
  deliveryDeadline: number;
  /** 0 until proof is submitted. */
  receiptDeadline: number;
  proof: Proof | null;
  dispute: Dispute | null;
  settlement: Settlement;
  /** Ledger the read was simulated against. */
  ledger: number;
}

/** What the buyer asks the factory to create. */
export interface Order {
  buyer: string;
  seller: string;
  token: string;
  amount: bigint;
  termsHash: string;
  releaseCodeHash: string;
  fundingDeadline: number;
  deliveryWindow: number;
  receiptWindow: number;
  arbitrationWindow: number;
}

export interface FactoryConfig {
  admin: string;
  escrowWasmHash: string;
  arbitrator: string;
  feeRecipient: string;
  feeBps: number;
}

export const BPS_DENOMINATOR = 10_000n;

/** What the seller receives on release, and the platform fee. The fee is taken on release only (D17). */
export function payoutOnRelease(amount: bigint, feeBps: number): { payout: bigint; fee: bigint } {
  const fee = (amount * BigInt(feeBps)) / BPS_DENOMINATOR;
  return { payout: amount - fee, fee };
}
