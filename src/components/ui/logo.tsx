import { cn } from "@/lib/utils";

/**
 * The app mark: three flashcards fanned in a small stack — pale blue, mint and
 * cream on top. The colours are the cards' own, so the mark is the same in
 * Light and Dark. public/favicon.svg is the same drawing.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect x="9" y="6" width="19" height="14" rx="2.6" transform="rotate(14 18.5 13)" fill="#9aa8dc" />
      <rect x="3.5" y="11" width="20" height="15" rx="2.6" transform="rotate(-12 13.5 18.5)" fill="#8fd6bf" />
      <rect x="7" y="8.5" width="20" height="15" rx="2.6" transform="rotate(-3 17 16)" fill="#f6ecd6" />
      <rect
        x="7"
        y="8.5"
        width="20"
        height="15"
        rx="2.6"
        transform="rotate(-3 17 16)"
        fill="none"
        stroke="#b99a5a"
        strokeOpacity="0.55"
        strokeWidth="0.8"
      />
      <path
        d="M12 14h10M12 18h6.5"
        transform="rotate(-3 17 16)"
        stroke="#2a2018"
        strokeOpacity="0.7"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark beside the product's name, set in the display serif. */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={compact ? "h-7 w-7 shrink-0" : "h-9 w-9 shrink-0"} />
      <span
        className={cn(
          "font-display font-bold leading-none tracking-[-0.01em] text-foreground",
          compact ? "text-[1.05rem]" : "text-[1.3rem] sm:text-[1.45rem]"
        )}
      >
        Flashcards for All
      </span>
    </span>
  );
}
