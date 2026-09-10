// Button primitive for the whole app.
//
// Reimplemented rather than pulled from a component library: the app needs a
// handful of variants, and every colour comes from the theme tokens in
// styles.css, so the same markup is correct in Light and Dark.

import type { ButtonHTMLAttributes, Ref } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "@/components/ui/button-styles";

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ref,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // React 19 passes ref as an ordinary prop to function components.
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={ref} type={type} {...props} className={buttonClasses(variant, size, className)}>
      {children}
    </button>
  );
}
