import type { EscrowState } from '@/sdk/types';
import type { VaultEnvelope } from '@/sdk/vault';
import { config } from './config';

/**
 * Typed client for trustedescrow-backend. The backend adds convenience, never
 * authority: nothing returned here is used to decide where money goes. Escrow state
 * that drives an action is read from the chain directly (src/sdk/chain.ts).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'trustescrow.session';
const DEVICE_KEY = 'trustescrow.device';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const session = {
  get token(): string | null {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  },
  set(token: string) {
    storage()?.setItem(TOKEN_KEY, token);
  },
  clear() {
    storage()?.removeItem(TOKEN_KEY);
  },
};

/** A random id this browser keeps, so the backend can recognise a trusted device. */
export function deviceId(): string {
  const s = storage();
  let id = s?.getItem(DEVICE_KEY) ?? null;
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
    s?.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

type Query = Record<string, string | number | boolean | undefined>;

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Query; form?: FormData; raw?: boolean } = {},
  retries = 3,
  delayMs = 500,
): Promise<T> {
  const url = new URL(config.apiUrl + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  const token = session.token;
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the TrustEscrow service. Your escrows are unaffected: they live on-chain.');
  }

  if (res.status === 429 && retries > 0) {
    const retryHeader = res.headers.get('Retry-After');
    const parsedWait = retryHeader ? parseInt(retryHeader, 10) * 1000 : NaN;
    const waitTime = !isNaN(parsedWait) && parsedWait > 0 ? parsedWait : delayMs;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    return request<T>(method, path, opts, retries - 1, delayMs * 2);
  }

  if (opts.raw) {
    if (!res.ok) throw await toError(res);
    return res as unknown as T;
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    const defaultMsg = res.status === 429 ? 'Rate limit exceeded. Please wait a moment before trying again.' : res.statusText;
    const defaultCode = res.status === 429 ? 'TOO_MANY_REQUESTS' : 'ERROR';
    return new ApiError(res.status, j.error?.code ?? defaultCode, j.error?.message ?? defaultMsg, j.error?.details);
  } catch {
    const defaultMsg = res.status === 429 ? 'Rate limit exceeded. Please wait a moment before trying again.' : res.statusText || 'Request failed';
    const defaultCode = res.status === 429 ? 'TOO_MANY_REQUESTS' : 'ERROR';
    return new ApiError(res.status, defaultCode, defaultMsg);
  }
}

// --- types ---------------------------------------------------------------------------

export interface Me {
  id: string;
  address: string;
  payoutAddress: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  roles: string[];
  createdAt: string;
}

export interface Challenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface LoginResult {
  token: string;
  status: 'active' | 'pending_2fa';
  requiresTwoFactor: boolean;
  expiresAt: string;
}

export type DeliveryMethod = 'in_person' | 'shipped' | 'digital' | 'service';
export type ProofKindName = 'Tracking' | 'Content' | 'Attestation';

export interface TermsInput {
  rail: string;
  /** Token base units, decimal string. */
  amount: string;
  item: { title: string; description: string };
  delivery: { method: DeliveryMethod; proofKind: ProofKindName; carrier?: string; notes?: string };
  windows: { delivery: number; receipt: number; arbitration: number };
  /** Unix seconds. */
  fundingDeadline: number;
}

export interface CanonicalTerms extends TermsInput {
  version: 1;
  ref: string;
  buyer: string;
  seller: string;
  token: string;
}

export type DraftStatus = 'negotiating' | 'agreed' | 'linked' | 'withdrawn';

export interface Draft {
  id: string;
  status: DraftStatus;
  role: 'buyer' | 'seller' | 'arbitrator' | null;
  buyerAddress: string;
  sellerAddress: string;
  currentRevision: number;
  agreedRevision: number | null;
  termsHash: string | null;
  escrowContractId: string | null;
  releaseCodeHash: string | null;
  linkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Revision {
  revision: number;
  proposedBy: string;
  terms: CanonicalTerms;
  termsHash: string;
  note: string | null;
  createdAt: string;
  acceptedBy: string[];
}

export interface DraftDetail extends Draft {
  revisions: Revision[];
}

export interface Message {
  seq: number;
  senderRole: 'buyer' | 'seller' | 'arbitrator' | 'system';
  senderAddress: string | null;
  body: string;
  createdAt: string;
}

export interface CachedEscrow {
  source: 'cache';
  contractId: string;
  buyer: string;
  seller: string;
  draftId: string | null;
  state: EscrowState | null;
  token: string | null;
  amount: string | null;
  feeBps: number | null;
  termsHash: string | null;
  deadlines: { funding: string | null; delivery: string | null; receipt: string | null; arbitration: string | null };
  proof: { kind: string; uri: string; hash: string; submittedAt: string } | null;
  dispute: { openedBy: string; openedAt: string; deadline: string } | null;
  settlement: 'Open' | 'Released' | 'Refunded' | null;
  settlementPath: string | null;
  createdLedger: number;
  snapshotLedger: number | null;
  snapshotAt: string | null;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  escrow_contract_id: string | null;
  draft_id: string | null;
  send_at: string;
  read_at: string | null;
}

export interface Evidence {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  description: string | null;
  uploader_role: string;
  created_at: string;
  uploaded_by?: string;
}

export interface Statement {
  id?: string;
  role: string;
  statement: string;
  created_at: string;
  address: string;
}

export interface VaultRead {
  draftId: string;
  releaseCodeHash: string;
  createdAt: string;
  envelopes: (VaultEnvelope & { createdAt: string })[];
}

export interface Meta {
  network: string;
  rpcUrl: string;
  factoryContractId: string | null;
  rails: { id: string; tokenAddress: string; displaySymbol: string; decimals: number }[];
  windowBounds: { minSeconds: number; maxSeconds: number };
}

export interface CaseFile {
  escrow: Record<string, unknown>;
  draft: { id: string; agreedRevision: number; terms: CanonicalTerms } | null;
  termsCheck: { onChain: string; recomputed: string; match: boolean } | null;
  messages: { seq: number; sender_role: string; body: string; created_at: string; sender_address: string | null }[];
  statements: Statement[];
  evidence: Evidence[];
}

export interface Stats {
  outcomes: { settlement: string; path: string | null; count: number }[];
  twoSidedReleaseShare: number | null;
  escalationRate: number | null;
  proofsSubmitted: number;
  escalations: number;
  openDisputes: number;
}

// --- endpoints -----------------------------------------------------------------------

export const api = {
  meta: () => request<Meta>('GET', '/meta'),

  challenge: (address: string) => request<Challenge>('POST', '/auth/challenge', { body: { address } }),
  login: (challengeId: string, signature: string) =>
    request<LoginResult>('POST', '/auth/login', { body: { challengeId, signature, deviceId: deviceId(), deviceLabel: deviceLabel() } }),
  twoFactorLogin: (code: string) => request<{ status: 'active' }>('POST', '/auth/2fa', { body: { code } }),
  stepUpChallenge: () => request<Challenge>('POST', '/auth/step-up/challenge'),
  stepUpWithSignature: (challengeId: string, signature: string) =>
    request<{ stepUpUntil: string }>('POST', '/auth/step-up', { body: { challengeId, signature } }),
  stepUpWithCode: (code: string) => request<{ stepUpUntil: string }>('POST', '/auth/step-up', { body: { code } }),
  logout: () => request<void>('POST', '/auth/logout'),

  me: () => request<Me>('GET', '/me'),
  updateMe: (displayName: string | null) => request<Me>('PATCH', '/me', { body: { displayName } }),
  setPayoutAddress: (address: string) => request<Me>('PUT', '/me/payout-address', { body: { address } }),
  setEmail: (email: string) => request<{ email: string; emailVerified: boolean }>('PUT', '/me/email', { body: { email } }),
  verifyEmail: (token: string) => request<{ emailVerified: true }>('POST', '/me/email/verify', { body: { token } }),
  sessions: () =>
    request<{ id: string; status: string; created_at: string; expires_at: string; ip: string | null; user_agent: string | null; device_label: string | null; current: boolean }[]>(
      'GET',
      '/me/sessions',
    ),
  revokeSession: (id: string) => request<void>('DELETE', `/me/sessions/${id}`),
  devices: () => request<{ id: string; label: string | null; trusted_at: string | null; first_seen_at: string; last_seen_at: string }[]>('GET', '/me/devices'),
  forgetDevice: (id: string) => request<void>('DELETE', `/me/devices/${id}`),
  twoFactorSetup: () => request<{ secret: string; otpauthUri: string }>('POST', '/me/2fa/setup'),
  twoFactorEnable: (code: string) => request<{ enabled: true; backupCodes: string[] }>('POST', '/me/2fa/enable', { body: { code } }),
  twoFactorDisable: (code: string) => request<{ enabled: false }>('POST', '/me/2fa/disable', { body: { code } }),
  backupCodes: () => request<{ backupCodes: string[] }>('POST', '/me/2fa/backup-codes'),

  createDraft: (body: { role: 'buyer' | 'seller'; counterpartyAddress: string; terms: TermsInput; note?: string }) =>
    request<Draft & { terms: CanonicalTerms }>('POST', '/drafts', { body }),
  drafts: (status?: DraftStatus) => request<Draft[]>('GET', '/drafts', { query: { status } }),
  draft: (id: string) => request<DraftDetail>('GET', `/drafts/${id}`),
  revise: (id: string, terms: TermsInput, note?: string) =>
    request<{ revision: number; terms: CanonicalTerms; termsHash: string }>('POST', `/drafts/${id}/revisions`, { body: { terms, note } }),
  accept: (id: string, revision: number) => request<Draft>('POST', `/drafts/${id}/accept`, { body: { revision } }),
  agreedTerms: (id: string) => request<{ revision: number; terms: CanonicalTerms; canonical: string; termsHash: string }>('GET', `/drafts/${id}/terms`),
  withdraw: (id: string) => request<Draft>('POST', `/drafts/${id}/withdraw`),
  link: (id: string, contractId: string) =>
    request<{ draft: Draft; escrow: Record<string, unknown>; vault: { stored: boolean; matchesOnChainHash?: boolean } }>('POST', `/drafts/${id}/link`, {
      body: { contractId },
    }),

  messages: (id: string, after = 0) => request<{ messages: Message[]; nextAfter: number }>('GET', `/drafts/${id}/messages`, { query: { after, limit: 200 } }),
  sendMessage: (id: string, body: string) => request<Message>('POST', `/drafts/${id}/messages`, { body: { body } }),

  putVault: (id: string, releaseCodeHash: string, envelope: VaultEnvelope) =>
    request<{ draftId: string; releaseCodeHash: string; credentialId: string }>('PUT', `/drafts/${id}/vault`, { body: { releaseCodeHash, envelope } }),
  getVault: (id: string) => request<VaultRead>('GET', `/drafts/${id}/vault`),

  uploadEvidence: (id: string, file: Blob, filename: string, description?: string) => {
    const form = new FormData();
    if (description) form.append('description', description);
    form.append('file', file, filename);
    return request<Evidence>('POST', `/drafts/${id}/evidence`, { form });
  },
  evidence: (id: string) => request<Evidence[]>('GET', `/drafts/${id}/evidence`),
  downloadEvidence: (evidenceId: string) => request<Response>('GET', `/evidence/${evidenceId}/download`, { raw: true }),
  submitStatement: (id: string, statement: string) => request<Statement>('POST', `/drafts/${id}/dispute-case`, { body: { statement } }),
  statements: (id: string) => request<Statement[]>('GET', `/drafts/${id}/dispute-case`),

  escrows: (q: { role?: 'buyer' | 'seller' | 'any'; state?: EscrowState } = {}) => request<CachedEscrow[]>('GET', '/escrows', { query: q }),
  escrowDraftId: (contractId: string) => request<{ draftId: string | null }>('GET', `/escrows/${contractId}`),

  notifications: (unreadOnly = false) => request<Notification[]>('GET', '/notifications', { query: { unreadOnly, limit: 100 } }),
  readNotification: (id: string) => request<void>('POST', `/notifications/${id}/read`),
  readAllNotifications: () => request<void>('POST', '/notifications/read-all'),

  disputes: () => request<CachedEscrow[]>('GET', '/arbitration/disputes'),
  caseFile: (contractId: string) => request<CaseFile>('GET', `/arbitration/escrows/${contractId}`),
  stats: () => request<Stats>('GET', '/arbitration/stats'),
};

export const isStepUpRequired = (e: unknown) => e instanceof ApiError && e.status === 403 && e.code === 'STEP_UP_REQUIRED';

/**
 * The draft behind an escrow. The backend answers from its read cache, whose row only
 * appears once the indexer sees the factory event; a linked draft already records its
 * escrow, so fall back to that and a just-created escrow is usable at once.
 */
export async function draftIdForEscrow(contractId: string): Promise<string | null> {
  const fromCache = (await api.escrowDraftId(contractId)).draftId;
  if (fromCache) return fromCache;
  const linked = await api.drafts('linked');
  return linked.find((d) => d.escrowContractId === contractId)?.id ?? null;
}
