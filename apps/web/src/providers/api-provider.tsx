"use client";

import React, { createContext, useContext } from "react";

import { API_BASE } from "@/lib/api-client";

const ApiContext = createContext({ baseUrl: API_BASE });

export function ApiProvider({
  children,
  baseUrl = API_BASE
}: {
  children: React.ReactNode;
  baseUrl?: string;
}): JSX.Element {
  return <ApiContext.Provider value={{ baseUrl }}>{children}</ApiContext.Provider>;
}

export function useApiBase(): string {
  return useContext(ApiContext).baseUrl;
}
