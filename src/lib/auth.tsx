'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, api, type Me, session } from './api';
import { config } from './config';
import { freighter, WalletError } from './wallet';

/**
 * Two identities, kept separate on purpose:
 *
 * - the backend session (SEP-53 sign-in), which gates drafts, chat and the vault;
 * - the wallet account, which signs contract calls.
 *
 * The contract only ever sees the wallet. Every on-chain action is keyed to
 * `walletAddress`, and the UI warns when it differs from the signed-in account.
 */

type Status = 'loading' | 'signed_out' | 'pending_2fa' | 'signed_in';

interface AuthState {
  status: Status;
  me: Me | null;
  walletAddress: string | null;
  signIn(): Promise<void>;
  completeTwoFactor(code: string): Promise<void>;
  signOut(): Promise<void>;
  connectWallet(): Promise<string>;
  refreshMe(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadSession(): Promise<{ me: Me | null; status: Exclude<Status, 'loading'> }> {
  if (!session.token) return { me: null, status: 'signed_out' };
  try {
    return { me: await api.me(), status: 'signed_in' };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && e.code === 'TWO_FACTOR_REQUIRED') return { me: null, status: 'pending_2fa' };
    if (e instanceof ApiError && e.status === 401) session.clear();
    // Unreachable backend: keep the token and show signed-out UI for backend features.
    return { me: null, status: 'signed_out' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const qc = useQueryClient();

  const refreshMe = useCallback(async () => {
    const next = await loadSession();
    setMe(next.me);
    setStatus(next.status);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSession().then((next) => {
      if (cancelled) return;
      setMe(next.me);
      setStatus(next.status);
    });
    void freighter
      .currentAddress()
      .then((a) => !cancelled && setWalletAddress(a))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow account switches in the wallet.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void import('@stellar/freighter-api').then(({ WatchWalletChanges }) => {
      try {
        const watcher = new WatchWalletChanges(3000);
        watcher.watch(({ address }) => setWalletAddress(address || null));
        stop = () => watcher.stop();
      } catch {
        /* wallet not installed */
      }
    });
    return () => stop?.();
  }, []);

  const connectWallet = useCallback(async () => {
    const address = await freighter.connect();
    const network = await freighter.networkPassphrase();
    if (network && network !== config.networkPassphrase) {
      throw new WalletError(`Freighter is on a different network. Switch it to ${config.network} and try again.`, 'wrong_network');
    }
    setWalletAddress(address);
    return address;
  }, []);

  const signIn = useCallback(async () => {
    const address = await connectWallet();
    const challenge = await api.challenge(address);
    const signature = await freighter.signMessage(challenge.message, { address, networkPassphrase: config.networkPassphrase });
    const result = await api.login(challenge.challengeId, signature);
    session.set(result.token);
    qc.clear();
    if (result.requiresTwoFactor) setStatus('pending_2fa');
    else await refreshMe();
  }, [connectWallet, qc, refreshMe]);

  const completeTwoFactor = useCallback(
    async (code: string) => {
      await api.twoFactorLogin(code.trim());
      await refreshMe();
    },
    [refreshMe],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* already gone */
    }
    session.clear();
    qc.clear();
    setMe(null);
    setStatus('signed_out');
  }, [qc]);

  const value = useMemo(
    () => ({ status, me, walletAddress, signIn, completeTwoFactor, signOut, connectWallet, refreshMe }),
    [status, me, walletAddress, signIn, completeTwoFactor, signOut, connectWallet, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export const isArbitrator = (me: Me | null) => !!me?.roles.includes('arbitrator');
