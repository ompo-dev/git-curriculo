"use client";

import React, { useEffect } from "react";

import { ApiProvider } from "./api-provider";
import { StorageProvider } from "./storage-provider";
import { useAuthStore } from "@/store/use-auth-store";
import { useResumeStore } from "@/store/use-resume-store";

function StoreHydrator(): null {
  const hydrateAuth = useAuthStore((s) => s.hydrateFromBrowser);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const hydrateResume = useResumeStore((s) => s.hydrateFromBrowser);
  const resumeHydrated = useResumeStore((s) => s.hydrated);

  useEffect(() => {
    if (!authHydrated) hydrateAuth();
    if (!resumeHydrated) hydrateResume();
  }, [authHydrated, hydrateAuth, resumeHydrated, hydrateResume]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <StorageProvider>
      <ApiProvider>
        <StoreHydrator />
        {children}
      </ApiProvider>
    </StorageProvider>
  );
}
