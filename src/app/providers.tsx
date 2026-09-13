'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { AuthProvider } from '@/lib/auth';
import { StepUpProvider } from '@/lib/step-up';
import { TxProvider } from '@/lib/tx';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <StepUpProvider>
          <TxProvider>{children}</TxProvider>
        </StepUpProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
