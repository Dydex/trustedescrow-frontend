import type { EscrowSnapshot } from './types';

/**
 * Which contract calls make sense for this viewer, now. A mirror of the guards in
 * `contracts/escrow/src/lib.rs` so the UI only offers what can succeed; simulation
 * before signing is still the real check, because ledger time is not this clock.
 *
 * Deadlines follow the contract: at exactly the deadline the before-deadline action
 * is closed and the after-deadline action is open.
 */

export type Viewer = 'buyer' | 'seller' | 'arbitrator' | 'other';

export type ActionId =
  | 'fund'
  | 'cancel'
  | 'submit_proof'
  | 'submit_proof_with_code'
  | 'release_with_code'
  | 'confirm'
  | 'dispute'
  | 'escalate'
  | 'resolve'
  | 'refund_after_delivery_timeout'
  | 'refund_after_arbitration_timeout'
  | 'seller_refund'
  | 'reveal_code';

export interface AvailableAction {
  id: ActionId;
  /** Something the person must know before doing this. */
  warning?: string;
}

export function viewerOf(e: Pick<EscrowSnapshot, 'buyer' | 'seller' | 'arbitrator'>, address: string | null | undefined): Viewer {
  if (!address) return 'other';
  if (address === e.buyer) return 'buyer';
  if (address === e.seller) return 'seller';
  if (address === e.arbitrator) return 'arbitrator';
  return 'other';
}

export function availableActions(e: EscrowSnapshot, viewer: Viewer, now: number): AvailableAction[] {
  const out: AvailableAction[] = [];
  const add = (id: ActionId, warning?: string) => out.push(warning ? { id, warning } : { id });
  const party = viewer === 'buyer' || viewer === 'seller';

  switch (e.state) {
    case 'Created':
      if (viewer === 'buyer' && now < e.fundingDeadline) add('fund');
      if (party || now >= e.fundingDeadline) add('cancel');
      break;

    case 'Funded': {
      const beforeDelivery = now < e.deliveryDeadline;
      if (viewer === 'seller') {
        if (beforeDelivery) add('submit_proof');
        add(
          'submit_proof_with_code',
          beforeDelivery
            ? undefined
            : 'The delivery deadline has passed. Anyone can now refund the buyer, and a refund that lands first wins. Do not hand over the goods.',
        );
        add('seller_refund');
      }
      if (viewer === 'buyer') add('reveal_code');
      if (party && beforeDelivery) add('dispute');
      if (!beforeDelivery) add('refund_after_delivery_timeout');
      break;
    }

    case 'Delivered':
      if (viewer === 'buyer') {
        add('reveal_code');
        add('confirm');
      }
      if (viewer === 'seller' || viewer === 'other') add('release_with_code');
      if (viewer === 'seller') add('seller_refund');
      if (party) add('dispute');
      if (now >= e.receiptDeadline) add('escalate');
      break;

    case 'Disputed': {
      const deadline = e.dispute?.deadline ?? 0;
      if (viewer === 'arbitrator' && now < deadline) add('resolve');
      if (viewer === 'seller') add('seller_refund');
      if (now >= deadline) add('refund_after_arbitration_timeout');
      break;
    }

    case 'Released':
    case 'Refunded':
    case 'Cancelled':
      break;
  }
  return out;
}

export function has(actions: AvailableAction[], id: ActionId): AvailableAction | undefined {
  return actions.find((a) => a.id === id);
}

/** The next deadline that matters in this state, and what happens when it passes. */
export function nextDeadline(e: EscrowSnapshot): { at: number; label: string; after: string } | null {
  switch (e.state) {
    case 'Created':
      return { at: e.fundingDeadline, label: 'Funding deadline', after: 'The buyer can no longer fund it, and anyone may cancel.' };
    case 'Funded':
      return { at: e.deliveryDeadline, label: 'Delivery deadline', after: 'If the seller has not submitted proof, the buyer can be refunded.' };
    case 'Delivered':
      return { at: e.receiptDeadline, label: 'Receipt deadline', after: 'If the buyer has not given receipt or disputed, the arbitrator decides.' };
    case 'Disputed':
      return e.dispute
        ? { at: e.dispute.deadline, label: 'Arbitration deadline', after: 'If the arbitrator has not ruled, the buyer is refunded.' }
        : null;
    default:
      return null;
  }
}
