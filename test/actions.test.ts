import { describe, expect, it } from 'vitest';
import { type ActionId, availableActions, nextDeadline, viewerOf } from '@/sdk/actions';
import type { EscrowSnapshot } from '@/sdk/types';

const BUYER = 'GBUYER';
const SELLER = 'GSELLER';
const ARB = 'GARB';

function escrow(over: Partial<EscrowSnapshot> = {}): EscrowSnapshot {
  return {
    contractId: 'CESCROW',
    buyer: BUYER,
    seller: SELLER,
    arbitrator: ARB,
    token: 'CTOKEN',
    amount: 100n,
    feeBps: 150,
    feeRecipient: 'GFEE',
    termsHash: '00'.repeat(32),
    releaseCodeHash: '11'.repeat(32),
    state: 'Created',
    createdAt: 0,
    fundingDeadline: 1000,
    deliveryWindow: 3600,
    receiptWindow: 3600,
    arbitrationWindow: 3600,
    fundedAt: 0,
    deliveryDeadline: 0,
    receiptDeadline: 0,
    proof: null,
    dispute: null,
    settlement: { status: 'Open' },
    ledger: 1,
    ...over,
  };
}

const ids = (e: EscrowSnapshot, who: Parameters<typeof availableActions>[1], now: number): ActionId[] =>
  availableActions(e, who, now).map((a) => a.id);

describe('Created', () => {
  const e = escrow();
  it('lets the buyer fund before the funding deadline, not at it', () => {
    expect(ids(e, 'buyer', 999)).toContain('fund');
    expect(ids(e, 'buyer', 1000)).not.toContain('fund');
  });
  it('lets parties cancel any time and anyone after the deadline', () => {
    expect(ids(e, 'seller', 0)).toEqual(['cancel']);
    expect(ids(e, 'other', 999)).toEqual([]);
    expect(ids(e, 'other', 1000)).toEqual(['cancel']);
  });
});

describe('Funded', () => {
  const e = escrow({ state: 'Funded', fundedAt: 100, deliveryDeadline: 5000 });
  it('offers the seller proof, the in-person path and a voluntary refund', () => {
    expect(ids(e, 'seller', 4999)).toEqual(['submit_proof', 'submit_proof_with_code', 'seller_refund', 'dispute']);
  });
  it('closes submit_proof and dispute at the delivery deadline and opens the timeout refund', () => {
    const late = availableActions(e, 'seller', 5000);
    expect(late.map((a) => a.id)).toEqual(['submit_proof_with_code', 'seller_refund', 'refund_after_delivery_timeout']);
    expect(late.find((a) => a.id === 'submit_proof_with_code')?.warning).toMatch(/Do not hand over/);
  });
  it('never offers the seller a payout', () => {
    for (const now of [0, 4999, 5000, 1e9]) {
      expect(ids(e, 'seller', now)).not.toContain('release_with_code');
      expect(ids(e, 'seller', now)).not.toContain('confirm');
    }
  });
  it('lets the buyer reveal the code for an in-person handover', () => {
    expect(ids(e, 'buyer', 0)).toEqual(['reveal_code', 'dispute']);
  });
});

describe('Delivered', () => {
  const e = escrow({
    state: 'Delivered',
    deliveryDeadline: 5000,
    receiptDeadline: 9000,
    proof: { kind: 'Tracking', uri: 'https://t.example/1', hash: '22'.repeat(32), submittedAt: 4000 },
  });
  it('gives the buyer receipt actions', () => {
    expect(ids(e, 'buyer', 8999)).toEqual(['reveal_code', 'confirm', 'dispute']);
  });
  it('lets the seller or a courier present the code', () => {
    expect(ids(e, 'seller', 0)).toContain('release_with_code');
    expect(ids(e, 'other', 0)).toEqual(['release_with_code']);
  });
  it('escalates, never pays, when the receipt deadline passes', () => {
    expect(ids(e, 'other', 9000)).toEqual(['release_with_code', 'escalate']);
  });
});

describe('Disputed', () => {
  const e = escrow({
    state: 'Disputed',
    dispute: { openedBy: 'ReceiptTimeout', openedAt: 9000, fromState: 'Delivered', deadline: 20000 },
  });
  it('lets only the arbitrator resolve, only before the deadline', () => {
    expect(ids(e, 'arbitrator', 19999)).toEqual(['resolve']);
    expect(ids(e, 'buyer', 19999)).toEqual([]);
    expect(ids(e, 'arbitrator', 20000)).toEqual(['refund_after_arbitration_timeout']);
  });
  it('still lets the seller concede', () => {
    expect(ids(e, 'seller', 0)).toEqual(['seller_refund']);
  });
});

it('offers nothing in terminal states', () => {
  for (const state of ['Released', 'Refunded', 'Cancelled'] as const) {
    for (const who of ['buyer', 'seller', 'arbitrator', 'other'] as const) {
      expect(ids(escrow({ state }), who, 1e12)).toEqual([]);
    }
  }
});

it('identifies the viewer', () => {
  const e = escrow();
  expect(viewerOf(e, BUYER)).toBe('buyer');
  expect(viewerOf(e, SELLER)).toBe('seller');
  expect(viewerOf(e, ARB)).toBe('arbitrator');
  expect(viewerOf(e, 'GX')).toBe('other');
  expect(viewerOf(e, null)).toBe('other');
});

it('reports the deadline that matters', () => {
  expect(nextDeadline(escrow({ state: 'Delivered', receiptDeadline: 42 }))?.label).toBe('Receipt deadline');
  expect(nextDeadline(escrow({ state: 'Released' }))).toBeNull();
});
