'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Alert, Button, Modal, Spinner } from '@/components/ui';
import { EscrowChain, type SignTransaction, type Step } from '@/sdk/chain';
import { useAuth } from './auth';
import { config, explorerTxUrl } from './config';
import { freighter, WalletError } from './wallet';

export const chain = new EscrowChain({
  rpcUrl: config.rpcUrl,
  networkPassphrase: config.networkPassphrase,
  factoryId: config.factoryContractId,
  escrowWasmHash: config.escrowWasmHash,
});

const STEP_LABEL: Record<Step, string> = {
  simulating: 'Checking the transaction against the contract',
  restoring: 'This escrow was archived. Restoring it first (one extra signature)',
  signing: 'Waiting for your signature in Freighter',
  submitting: 'Submitting to the network',
  confirming: 'Waiting for the ledger to confirm',
};

interface TxView {
  title: string;
  step: Step | null;
  hash?: string;
  error?: unknown;
  done?: boolean;
}

interface TxState {
  /**
   * Runs one on-chain operation behind a progress dialog. `fn` receives a signer bound to
   * the connected wallet and a step reporter. Resolves with fn's result, or rejects.
   */
  run<T extends { hash?: string } | void>(title: string, fn: (ctx: { sign: SignTransaction; onStep: (s: Step) => void; address: string }) => Promise<T>): Promise<T>;
}

const TxContext = createContext<TxState | null>(null);

export function TxProvider({ children }: { children: ReactNode }) {
  const { walletAddress, connectWallet } = useAuth();
  const [view, setView] = useState<TxView | null>(null);

  const run = useCallback<TxState['run']>(
    async (title, fn) => {
      setView({ title, step: null });
      try {
        const address = walletAddress ?? (await connectWallet());
        const sign: SignTransaction = async (xdr) => {
          const network = await freighter.networkPassphrase();
          if (network && network !== config.networkPassphrase) {
            throw new WalletError(`Freighter is on a different network. Switch it to ${config.network}.`, 'wrong_network');
          }
          return freighter.signTransaction(xdr, { address, networkPassphrase: config.networkPassphrase });
        };
        const result = await fn({ sign, address, onStep: (step) => setView((v) => (v ? { ...v, step } : v)) });
        setView((v) => (v ? { ...v, done: true, step: null, hash: result && 'hash' in result ? result.hash : undefined } : v));
        return result;
      } catch (error) {
        setView((v) => (v ? { ...v, error, step: null } : v));
        throw error;
      }
    },
    [walletAddress, connectWallet],
  );

  const busy = !!view && !view.done && !view.error;
  const value = useMemo(() => ({ run }), [run]);

  return (
    <TxContext.Provider value={value}>
      {children}
      <Modal open={!!view} title={view?.title ?? ''} dismissable={!busy} onClose={() => setView(null)}>
        {view && (
          <div className="space-y-4">
            {busy && (
              <p className="flex items-center gap-3 text-sm text-slate-700">
                <Spinner className="text-brand-700" />
                {view.step ? STEP_LABEL[view.step] : 'Preparing'}
              </p>
            )}
            {view.done && (
              <Alert tone="success" title="Done">
                {view.hash && (
                  <a className="underline" href={explorerTxUrl(view.hash)} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                )}
              </Alert>
            )}
            {!!view.error && <Alert tone="danger" title="Nothing changed">{view.error instanceof Error ? view.error.message : String(view.error)}</Alert>}
            {!busy && (
              <div className="flex justify-end">
                <Button onClick={() => setView(null)}>Close</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </TxContext.Provider>
  );
}

export function useTx(): TxState {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error('useTx outside TxProvider');
  return ctx;
}
