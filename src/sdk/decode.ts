import { toHex } from './code';
import { type EscrowSnapshot, type EscrowState, type FactoryConfig, type ProofKind, STATES, type Settlement } from './types';

/**
 * Decodes the `scValToNative` form of the contract's `Escrow` struct.
 *
 * Structs arrive as objects keyed by Rust field names, unit enum variants as
 * `["Variant"]`, tuple variants as `["Variant", payload]`, u64/i128 as bigint and
 * BytesN as bytes. Optional parts are enums rather than `Option` (ARCHITECTURE §4):
 * `proof: ["Pending"] | ["Submitted", Proof]`.
 */

export class DecodeError extends Error {}

function tag(v: unknown, field: string): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  throw new DecodeError(`${field}: expected enum variant`);
}

function payload(v: unknown): unknown {
  return Array.isArray(v) ? v[1] : undefined;
}

function record(v: unknown, field: string): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)) return v as Record<string, unknown>;
  throw new DecodeError(`${field}: expected struct`);
}

function str(v: unknown, field: string): string {
  if (typeof v === 'string') return v;
  throw new DecodeError(`${field}: expected string`);
}

function int(v: unknown, field: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v);
  throw new DecodeError(`${field}: expected integer`);
}

function seconds(v: unknown, field: string): number {
  return Number(int(v, field));
}

function hex(v: unknown, field: string): string {
  if (v instanceof Uint8Array) return toHex(v);
  throw new DecodeError(`${field}: expected bytes`);
}

function state(v: unknown, field: string): EscrowState {
  const s = tag(v, field);
  if (!(STATES as readonly string[]).includes(s)) throw new DecodeError(`${field}: unknown state ${s}`);
  return s as EscrowState;
}

export function decodeEscrow(contractId: string, native: unknown, ledger: number): EscrowSnapshot {
  const e = record(native, 'escrow');

  let proof: EscrowSnapshot['proof'] = null;
  if (tag(e.proof, 'proof') === 'Submitted') {
    const p = record(payload(e.proof), 'proof');
    proof = {
      kind: tag(p.kind, 'proof.kind') as ProofKind,
      uri: str(p.uri, 'proof.uri'),
      hash: hex(p.hash, 'proof.hash'),
      submittedAt: seconds(p.submitted_at, 'proof.submitted_at'),
    };
  }

  let dispute: EscrowSnapshot['dispute'] = null;
  if (tag(e.dispute, 'dispute') === 'Opened') {
    const d = record(payload(e.dispute), 'dispute');
    dispute = {
      openedBy: tag(d.opened_by, 'dispute.opened_by') as 'Buyer' | 'Seller' | 'ReceiptTimeout',
      openedAt: seconds(d.opened_at, 'dispute.opened_at'),
      fromState: state(d.from_state, 'dispute.from_state'),
      deadline: seconds(d.deadline, 'dispute.deadline'),
    };
  }

  const settlementTag = tag(e.settlement, 'settlement');
  let settlement: Settlement;
  if (settlementTag === 'Open') settlement = { status: 'Open' };
  else if (settlementTag === 'Released')
    settlement = { status: 'Released', path: tag(payload(e.settlement), 'settlement.path') as 'Code' | 'Confirmation' | 'Arbitration' };
  else if (settlementTag === 'Refunded')
    settlement = {
      status: 'Refunded',
      path: tag(payload(e.settlement), 'settlement.path') as 'SellerRefund' | 'DeliveryTimeout' | 'Arbitration' | 'ArbitrationTimeout',
    };
  else throw new DecodeError(`settlement: unknown variant ${settlementTag}`);

  return {
    contractId,
    buyer: str(e.buyer, 'buyer'),
    seller: str(e.seller, 'seller'),
    arbitrator: str(e.arbitrator, 'arbitrator'),
    token: str(e.token, 'token'),
    amount: int(e.amount, 'amount'),
    feeBps: Number(int(e.fee_bps, 'fee_bps')),
    feeRecipient: str(e.fee_recipient, 'fee_recipient'),
    termsHash: hex(e.terms_hash, 'terms_hash'),
    salt: hex(e.salt, 'salt'),
    releaseCodeHash: hex(e.release_code_hash, 'release_code_hash'),
    state: state(e.state, 'state'),
    createdAt: seconds(e.created_at, 'created_at'),
    fundingDeadline: seconds(e.funding_deadline, 'funding_deadline'),
    deliveryWindow: seconds(e.delivery_window, 'delivery_window'),
    receiptWindow: seconds(e.receipt_window, 'receipt_window'),
    arbitrationWindow: seconds(e.arbitration_window, 'arbitration_window'),
    fundedAt: seconds(e.funded_at, 'funded_at'),
    deliveryDeadline: seconds(e.delivery_deadline, 'delivery_deadline'),
    receiptDeadline: seconds(e.receipt_deadline, 'receipt_deadline'),
    proof,
    dispute,
    settlement,
    ledger,
  };
}

export function decodeFactoryConfig(native: unknown): FactoryConfig {
  const c = record(native, 'config');
  return {
    admin: str(c.admin, 'admin'),
    escrowWasmHash: hex(c.escrow_wasm_hash, 'escrow_wasm_hash'),
    arbitrator: str(c.arbitrator, 'arbitrator'),
    feeRecipient: str(c.fee_recipient, 'fee_recipient'),
    feeBps: Number(int(c.fee_bps, 'fee_bps')),
  };
}
