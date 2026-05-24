import * as React from "react";

import { cn } from "../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-8 w-full rounded-md border border-[var(--gc-border)] bg-[var(--gc-input-bg)] px-3 py-[5px] text-sm text-[var(--gc-text)] shadow-sm placeholder:text-[var(--gc-text-muted)] focus:border-[var(--gc-accent)] focus:outline-none focus:ring-[3px] focus:ring-[var(--gc-accent)]/20 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
