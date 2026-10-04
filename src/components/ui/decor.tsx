// Small decorative drawings shared across the site: the four-point sparkle,
// the gold ornament set under a card's term, and the hand-drawn doodles and
// notes that sit beside the artwork. All of it is decoration — hidden from
// assistive technology, never interactive, and bundled as inline SVG (the CSP
// allows no external images or fonts).

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

const SPARKLE_PATH =
  "M12 0c.7 6.9 4.4 10.6 12 12-7.6 1.4-11.3 5.1-12 12-.7-6.9-4.4-10.6-12-12C7.6 10.6 11.3 6.9 12 0Z";

/** A four-point star. Colour comes from `currentColor`. */
export function Sparkle({
  className,
  style,
  twinkle,
}: {
  className?: string;
  style?: CSSProperties;
  /** Seconds of delay for a slow twinkle; omit for a still star. */
  twinkle?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("sparkle pointer-events-none", twinkle !== undefined && "twinkle", className)}
      style={
        twinkle !== undefined
          ? ({ ...style, "--twinkle-delay": `${twinkle}s`, "--twinkle": `${4.5 + (twinkle % 3)}s` } as CSSProperties)
          : style
      }
    >
      <path d={SPARKLE_PATH} fill="currentColor" />
    </svg>
  );
}

/** Two gold hairlines either side of a small star: the rule under a card's term. */
export function Ornament({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("ornament", className)}>
      <svg viewBox="0 0 24 24" className="h-[0.8em] w-[0.8em] shrink-0" focusable="false">
        <path d={SPARKLE_PATH} fill="currentColor" />
      </svg>
    </div>
  );
}

/** A handwritten aside beside the artwork. Decorative: the real copy says it properly. */
export function HandNote({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <p
      aria-hidden="true"
      className={cn(
        "pointer-events-none select-none font-hand text-[1.05rem] leading-snug text-hand",
        className
      )}
      style={style}
    >
      {children}
    </p>
  );
}

const DOODLE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function DoodleCap({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 48" aria-hidden="true" focusable="false" className={className} {...DOODLE}>
      <path d="M4 18 33 6l27 11-28 13L4 18Z" />
      <path d="M16 24v10c5 6 26 6 31-1V23" />
      <path d="M55 19v14m0 0-2.5 6m2.5-6 2.5 6" />
    </svg>
  );
}

export function DoodleBulb({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 60" aria-hidden="true" focusable="false" className={className} {...DOODLE}>
      <path d="M24 12c-8 0-13 6-13 12.5 0 5 3 7.5 5 10.5 1.2 1.8 1.5 3.5 1.5 5h13c0-1.5.3-3.2 1.5-5 2-3 5-5.5 5-10.5C37 18 32 12 24 12Z" />
      <path d="M18.5 45h11M19.5 49.5h9M22 54h4" />
      <path d="M20 27l4 4 4-4m-4 4v9" />
      <path d="M24 2v4M7 8l3 3M41 8l-3 3M2 24h4M42 24h4" />
    </svg>
  );
}

export function DoodleBook({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 48" aria-hidden="true" focusable="false" className={className} {...DOODLE}>
      <path d="M32 14c-6-5-16-6-26-4v28c10-2 20-1 26 4 6-5 16-6 26-4V10c-10-2-20-1-26 4Z" />
      <path d="M32 14v28" />
      <path d="M12 18c5-.8 10-.3 14 1.5M12 24c5-.8 10-.3 14 1.5M12 30c5-.8 10-.3 14 1.5M38 19.5c4-1.8 9-2.3 14-1.5M38 25.5c4-1.8 9-2.3 14-1.5M38 31.5c4-1.8 9-2.3 14-1.5" />
      <path d="M27 5l1.5-3M33 4V1M38 5l2-3" />
    </svg>
  );
}

/** A dashed, hand-drawn curve with an arrowhead, drawn left to right. */
export function DoodleArrow({ className, flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 80 40"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      {...DOODLE}
    >
      <path d="M4 30C18 8 44 4 70 16" />
      <path d="M60 9l11 7-12 5" />
    </svg>
  );
}

export function DoodleDash({ className, flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 90 60"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      {...DOODLE}
      strokeDasharray="4 6"
    >
      <path d="M4 6c10 30 40 46 82 46" />
    </svg>
  );
}
