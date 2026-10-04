// Timings for the card's three movements, in one place.
//
// They are deliberately different movements, so that what changed can be read
// from the motion alone:
//
//   flip      the same card turns over            (a turn about its own axis)
//   next      this card is moved aside, to the right, and the one beneath
//             comes forward
//   previous  the mirror image: aside to the left
//
// The durations mirror --dur-flip and --dur-nav in src/styles.css.

import type { Variants } from "framer-motion";

/** First half of a flip: accelerate toward edge-on. */
export const TURN_IN = { duration: 0.15, ease: [0.5, 0, 0.9, 0.55] } as const;
/** Second half: decelerate back to flat. */
export const TURN_OUT = { duration: 0.23, ease: [0.12, 0.6, 0.3, 1] } as const;

/** The card being moved aside: it leaves promptly. */
export const NAV_OUT = { duration: 0.26, ease: [0.4, 0, 0.75, 0.6] } as const;
/** The card coming forward from the stack: it settles. */
export const NAV_IN = { duration: 0.3, ease: [0.2, 0.75, 0.3, 1] } as const;

/** How far a card is moved aside, as a share of its width, and its limits in px. */
export const NAV_SHIFT = { ratio: 0.16, min: 48, max: 120 } as const;
/** How far it turns as it goes, in degrees. */
export const NAV_TILT = 5;

export function navShift(cardWidth: number): number {
  return Math.min(NAV_SHIFT.max, Math.max(NAV_SHIFT.min, cardWidth * NAV_SHIFT.ratio));
}

/** Held arrow keys repeat far faster than a card can be read or moved. */
export const KEY_REPEAT_INTERVAL_MS = 140;

/** Passed through AnimatePresence so an exiting card knows which way to leave. */
export interface CardMotion {
  /** 1 = moving to the next card, -1 = previous, 0 = no spatial meaning (filter, restart). */
  direction: -1 | 0 | 1;
  width: number;
  reduced: boolean;
  /** Where a swiped card was let go (0 for buttons and keys). */
  offset: number;
}

const RESTING = { x: 0, y: 0, rotate: 0, scale: 1 } as const;

/** Where the incoming card starts: on the stack, directly beneath the card being moved away. */
export function enterFrom({ direction, reduced }: CardMotion) {
  return reduced || direction === 0
    ? { ...RESTING, opacity: 0 }
    : { x: -direction * 8, y: 14, rotate: 0, scale: 0.95, opacity: 0 };
}

/**
 * Where the outgoing card goes. Buttons and keys: aside to the right for
 * Next, to the left for Previous. A swipe: onward in the direction it was
 * thrown, from where it was let go. Reduced motion, or a change with no
 * direction (filter, restart): it fades where it is.
 */
export function exitTo({ direction, width, reduced, offset }: CardMotion) {
  if (reduced || direction === 0) return { opacity: 0, transition: { duration: 0.12 } };
  const side = offset !== 0 ? Math.sign(offset) : direction;
  return {
    x: offset + side * navShift(width),
    y: -10,
    rotate: side * NAV_TILT,
    // Solid while it clears the card beneath, then gone: the two cards are
    // never a long double exposure of each other's text.
    opacity: [null, 1, 0],
    transition: {
      ...NAV_OUT,
      opacity: { duration: NAV_OUT.duration, times: [0, 0.5, 1], ease: "linear" as const },
    },
  };
}

export const cardVariants: Variants = {
  enter: enterFrom,
  center: ({ direction, reduced }: CardMotion) => ({
    ...RESTING,
    opacity: 1,
    transition:
      reduced || direction === 0 ? { duration: 0.16 } : { ...NAV_IN, opacity: { duration: 0.14 } },
  }),
  exit: exitTo,
};
