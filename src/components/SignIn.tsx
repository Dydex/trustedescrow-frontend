'use client';

import { type ReactNode, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card, ErrorText, Field, Input, Spinner } from './ui';

export function SignInPanel() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Card title="Sign in with your Stellar wallet">
      <div className="space-y-3 text-sm text-slate-600">
        <p>TrustEscrow uses Freighter. Your wallet signs a message to prove you own the account. The message authorises no transaction.</p>
        <ErrorText error={error} />
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await signIn();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Connect Freighter and sign in
        </Button>
      </div>
    </Card>
  );
}

function TwoFactorPanel() {
  const { completeTwoFactor, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeTwoFactor(code);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="New device: enter your 2FA code">
      <div className="space-y-3">
        <Field label="Authenticator or backup code">
          <Input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        </Field>
        <ErrorText error={error} />
        <div className="flex gap-2">
          <Button busy={busy} disabled={!code} onClick={() => void submit()}>
            Verify
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Backend features need a session. On-chain escrow pages do not: see `allowAnonymous`. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner /> Loading
      </p>
    );
  }
  if (status === 'pending_2fa') return <TwoFactorPanel />;
  if (status === 'signed_out') return <SignInPanel />;
  return <>{children}</>;
}

export function WalletMismatch({ expected, role }: { expected: string; role: string }) {
  const { walletAddress } = useAuth();
  if (!walletAddress || walletAddress === expected) return null;
  return (
    <Alert tone="warning" title={`Freighter is on a different account`}>
      This escrow&apos;s {role} is <span className="font-mono">{expected}</span>. Switch Freighter to that account to act as the {role}.
    </Alert>
  );
}
