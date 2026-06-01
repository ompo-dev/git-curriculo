export function readLocalStorage(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value.trim()) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore quota / privacy mode
  }
}

export function readSessionStorage(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSessionStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value.trim()) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function readJsonLocalStorage<T>(key: string, fallback: T): T {
  const raw = readLocalStorage(key, "");
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
