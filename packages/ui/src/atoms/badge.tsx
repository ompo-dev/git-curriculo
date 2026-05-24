import { cn } from "../lib/utils";

export function Badge({
  className,
  children
}: {
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-2.5 py-0.5 text-xs font-semibold text-[var(--gc-text-muted)]",
        className
      )}
    >
      {children}
    </span>
  );
}