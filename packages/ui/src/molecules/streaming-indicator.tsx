"use client";

import { Loader2 } from "lucide-react";

export function StreamingIndicator({ label = "Gerando..." }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--gc-text-muted)]">
      <Loader2 size={14} className="animate-spin" />
      <span>{label}</span>
    </div>
  );
}
