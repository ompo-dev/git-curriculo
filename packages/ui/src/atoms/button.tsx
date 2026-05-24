import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gc-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-[var(--gc-btn-primary-border)] bg-[var(--gc-btn-primary-bg)] text-[var(--gc-btn-primary-text)] shadow-sm hover:bg-[var(--gc-btn-primary-hover)]",
        secondary:
          "border-[var(--gc-btn-default-border)] bg-[var(--gc-btn-default-bg)] text-[var(--gc-btn-default-text)] shadow-sm hover:bg-[var(--gc-btn-default-hover)]",
        ghost:
          "border-transparent bg-transparent text-[var(--gc-text)] hover:bg-[var(--gc-btn-default-bg)]",
        danger:
          "border-[var(--gc-btn-primary-border)] bg-[var(--gc-danger)] text-white shadow-sm hover:brightness-95"
      },
      size: {
        default: "h-8 px-4 py-[5px] text-sm",
        sm: "h-7 px-3 py-[3px] text-xs",
        lg: "h-10 px-5 text-sm",
        icon: "h-8 w-8 p-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  )
);
Button.displayName = "Button";
