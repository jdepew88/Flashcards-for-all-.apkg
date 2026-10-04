// The button look, shared by <Button> and by elements that must not be a
// <button> (the file-input label). Every colour is a theme token; the mint
// primary and glass secondary surfaces are .btn-primary / .btn-glass in
// styles.css.

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  // Mint, lit from above: the one action a screen most wants taken.
  primary: "btn-primary",
  // A dark glass key, at home on a translucent panel.
  secondary: "btn-glass",
  ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
  danger: "bg-danger text-danger-foreground shadow-soft hover:bg-danger-hover",
  "danger-ghost": "text-danger hover:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 rounded-xl px-3 text-sm",
  md: "h-11 gap-2 rounded-xl px-4 text-[15px]",
  lg: "h-12 gap-2.5 rounded-2xl px-5 text-[15px]",
  icon: "h-11 w-11 rounded-xl",
  "icon-sm": "h-9 w-9 rounded-lg",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string
): string {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-semibold",
    "transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] duration-150 ease-out",
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    VARIANTS[variant],
    SIZES[size],
    className
  );
}
