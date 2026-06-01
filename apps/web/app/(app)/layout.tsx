"use client";

import { Suspense } from "react";

import { AppWorkspace } from "@/features/workspace/app-workspace";
import { AppProviders } from "@/providers/app-providers";

export default function AppLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <AppProviders>
      <Suspense fallback={<main className="p-6 text-sm text-[var(--gc-text-muted)]">Carregando...</main>}>
        <AppWorkspace />
      </Suspense>
      {/* Slot de rota (paginas vazias); UI vive no AppWorkspace acima */}
      <div className="hidden" aria-hidden>
        {children}
      </div>
    </AppProviders>
  );
}
