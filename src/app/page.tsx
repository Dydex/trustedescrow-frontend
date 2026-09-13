'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SignInPanel } from '@/components/SignIn';
import { useAuth } from '@/lib/auth';

const STEPS = [
  { n: '1', title: 'The buyer deposits', body: 'Funds go into a smart contract made for this one trade. Nobody, including TrustEscrow, can move them anywhere else.' },
  { n: '2', title: 'The seller proves delivery', body: 'A tracking reference, a file hash or a statement, committed on-chain. It cannot be changed afterwards.' },
  { n: '3', title: 'The buyer proves receipt', body: 'By handing over their delivery code once the item is in their hands, or by confirming. Only then is the seller paid.' },
];

export default function Home() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signed_in') router.replace('/dashboard');
  }, [status, router]);

  return (
    <div className="space-y-10">
      <section className="space-y-4 pt-4">
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Trade with strangers. Nobody gets paid on their own word.</h1>
        <p className="max-w-2xl text-slate-600">
          TrustEscrow holds the buyer&apos;s money in a Stellar smart contract. The seller is paid only when both sides have spoken. If they disagree, or one side goes
          silent, an arbitrator chooses between release and refund. No timer ever pays the seller.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <p className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 font-bold text-brand-800">{s.n}</p>
            <h2 className="mt-3 font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="max-w-xl">{status !== 'signed_in' && <SignInPanel />}</section>

      <p className="max-w-2xl text-xs text-slate-500">
        This web app is a convenience. Every escrow can be funded, completed, disputed or timed out directly against the contract from a CLI, with no TrustEscrow service
        running.
      </p>
    </div>
  );
}
