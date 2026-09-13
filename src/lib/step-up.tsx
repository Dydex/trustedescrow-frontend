'use client';

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Alert, Button, ErrorText, Field, Input, Modal } from '@/components/ui';
import { api, isStepUpRequired } from './api';
import { useAuth } from './auth';
import { config } from './config';
import { freighter } from './wallet';

/**
 * Backend-mediated sensitive actions (reading the vault, changing the payout address,
 * filing a dispute statement) need a fresh second factor. `withStepUp` runs the call,
 * and on STEP_UP_REQUIRED asks for a TOTP code, or a wallet signature for accounts
 * without 2FA, then retries once. This protects the session; it cannot and does not
 * gate on-chain calls (ARCHITECTURE D13).
 */

interface StepUpState {
  withStepUp<T>(fn: () => Promise<T>): Promise<T>;
}

const StepUpContext = createContext<StepUpState | null>(null);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setCode('');
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const withStepUp = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (!isStepUpRequired(e)) throw e;
        await ask();
        return fn();
      }
    },
    [ask],
  );

  const cancel = () => {
    setOpen(false);
    pending.current?.reject(new Error('Verification cancelled'));
    pending.current = null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (me?.twoFactorEnabled) {
        await api.stepUpWithCode(code.trim());
      } else {
        const address = me?.address;
        if (!address) throw new Error('Not signed in');
        const challenge = await api.stepUpChallenge();
        const signature = await freighter.signMessage(challenge.message, { address, networkPassphrase: config.networkPassphrase });
        await api.stepUpWithSignature(challenge.challengeId, signature);
      }
      setOpen(false);
      pending.current?.resolve();
      pending.current = null;
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepUpContext.Provider value={{ withStepUp }}>
      {children}
      <Modal open={open} title="Confirm it's you" onClose={cancel}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">This action is protected. Verify again to continue. It stays unlocked for five minutes.</p>
          {me?.twoFactorEnabled ? (
            <Field label="Authenticator or backup code">
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && code && void submit()}
              />
            </Field>
          ) : (
            <Alert tone="info">Your wallet will ask you to sign a message. It does not authorise any transaction.</Alert>
          )}
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
            <Button busy={busy} disabled={me?.twoFactorEnabled && !code} onClick={() => void submit()}>
              {me?.twoFactorEnabled ? 'Verify' : 'Sign with wallet'}
            </Button>
          </div>
        </div>
      </Modal>
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpState {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp outside StepUpProvider');
  return ctx;
}
