import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Header } from '@/components/Header';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'TrustEscrow', template: '%s · TrustEscrow' },
  description: 'Peer-to-peer escrow on Stellar. The seller is paid only when both sides have spoken.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#065f46' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
