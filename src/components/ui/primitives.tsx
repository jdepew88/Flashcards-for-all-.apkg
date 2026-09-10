// Minimal stand-ins for the shadcn/ui primitives the extracted flashcard
// components used (Badge, Button, Card). Reimplemented rather than copied so
// the standalone app does not pull in Radix, class-variance-authority and the
// rest of the CCNA design system for three small elements.

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "outline" | "success";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: "border-transparent bg-brand-blue/12 text-brand-blue",
  outline: "border-border text-muted-foreground",
  success: "border-transparent bg-brand-green/15 text-brand-green",
};

export function Badge({
  variant = "default",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        BADGE_VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

type ButtonVariant = "default" | "secondary" | "outline" | "ghost";
type ButtonSize = "default" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-brand-blue text-white hover:opacity-90",
  secondary: "bg-surface-muted text-foreground hover:opacity-80",
  outline: "border border-border bg-transparent hover:bg-surface-muted",
  ghost: "bg-transparent hover:bg-surface-muted",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: "h-10 px-4 py-2",
  icon: "h-10 w-10",
};

export function Button({
  variant = "default",
  size = "default",
  className,
  children,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // React 19 passes ref as an ordinary prop to function components, so no
  // forwardRef wrapper is needed — it just has to be declared.
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
        "disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-2xl border border-border bg-surface-elevated shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-2 p-5 sm:p-6", className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h2 className={cn("text-lg font-semibold tracking-tight", className)}>{children}</h2>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("p-5 pt-0 sm:p-6 sm:pt-0", className)}>{children}</div>;
}
