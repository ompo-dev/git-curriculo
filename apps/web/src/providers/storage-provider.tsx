"use client";

import React, { createContext, useContext, useMemo } from "react";

import { BrowserSqliteStorage, LocalStateStorage, SecureStorage, type StorageAdapter } from "@gitcurriculo/core";

import { isTauri } from "@/lib/runtime";
import { TauriStorageAdapter } from "@/lib/tauri-storage";

const StorageContext = createContext<{
  storage: StorageAdapter;
  secureStorage: SecureStorage;
  localStateStorage: LocalStateStorage;
} | null>(null);

export function StorageProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const value = useMemo(() => {
    const storage: StorageAdapter = isTauri()
      ? new TauriStorageAdapter()
      : new BrowserSqliteStorage({
          locateFile: (file) => `/sql-wasm/${file.replace("sql-wasm-browser.wasm", "sql-wasm.wasm")}`
        });
    return {
      storage,
      secureStorage: new SecureStorage(),
      localStateStorage: new LocalStateStorage()
    };
  }, []);

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
}

export function useStorage(): {
  storage: StorageAdapter;
  secureStorage: SecureStorage;
  localStateStorage: LocalStateStorage;
} {
  const ctx = useContext(StorageContext);
  if (!ctx) throw new Error("useStorage deve ser usado dentro de StorageProvider");
  return ctx;
}
