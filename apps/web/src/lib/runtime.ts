export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

export function isBrowser(): boolean {
  return typeof window !== "undefined" && !isTauri();
}
