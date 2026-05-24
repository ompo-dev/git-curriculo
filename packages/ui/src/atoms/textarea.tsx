import * as React from "react";

import { cn } from "../lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-32 w-full rounded-md border border-[var(--gc-border)] bg-[var(--gc-input-bg)] px-3 py-2 text-sm text-[var(--gc-text)] shadow-sm placeholder:text-[var(--gc-text-muted)] focus:border-[var(--gc-accent)] focus:outline-none focus:ring-[3px] focus:ring-[var(--gc-accent)]/20",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";