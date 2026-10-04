// Timings and poses for the card's three movements, in one place.
//
// They are deliberately different movements, so that what changed can be read
// from the motion alone:
//
//   flip      the same card turns over            (a turn about its own axis)
//   next      this card is moved aside, to the right, and the one beneath
//             comes forward
//   previous  the mirror image: aside to the left
//
// The feel is a stiff card handled by hand: deliberate, never springy. Movement
// carries the meaning; opacity only supports it. A card is never faded to
// nothing in place, and there is never a frame without a card on the stage.
// The durations mirror --dur-flip and --dur-nav in src/styles.css.

import { createContext } from "react";

/** One whole turn, 0° → 180°: eases in, passes edge-on briskly, settles slowly. */
export const FLIP = { duration: 0.5, ease: [0.4, 0, 0.2, 1] } as const;

/**
 * A card change. Both cards move together for the whole of it: the outgoing
 * one aside, the incoming one forward from the stack.
 */
export const NAV = { duration: 0.44, ease: [0.25, 0.8, 0.3, 1] } as const;

/** Reduced motion, and changes with no direction (filter, restart). */
export const CROSSFADE = { duration: 0.12 } as const;

/**
 * A card still leaving when the reader moves on again leaves at once, so no
 * more than two cards are ever on the stage.
 */
export const SUPERSEDED = { duration: 0.1 } as const;

/** How far a card is moved aside, as a share of its width, and its limits in px. */
export const NAV_SHIFT = { ratio: 0.14, min: 48, max: 64 } as const;
/** How far it turns as it goes, in degrees. */
export const NAV_TILT = 2.5;
/** How far a dragged card leans, in degrees per card width of travel. */
export const DRAG_TILT = 8;
/**
 * The outgoing card's last moments, as shares of the move. It stays fully
 * solid while it travels — a translucent card would show the next card's text
 * through its own. Once it is nearly aside, its printing fades off the still
 * solid paper (INK), and only then does the blank paper dissolve (PAPER) to
 * uncover the card beneath. Two texts are never legible over each other.
 */
export const NAV_INK_FADE = [0.5, 0.72] as const;
export const NAV_PAPER_FADE = [0.74, 1] as const;

export function navShift(cardWidth: number): number {
  return Math.min(NAV_SHIFT.max, Math.max(NAV_SHIFT.min, cardWidth * NAV_SHIFT.ratio));
}

/** Held arrow keys repeat far faster than a card can be read or moved. */
export const KEY_REPEAT_INTERVAL_MS = 140;

/** What a card needs to know to move: passed down from the study screen. */
export interface CardMotion {
  /** 1 = moving to the next card, -1 = previous, 0 = no spatial meaning (filter, restart). */
  direction: -1 | 0 | 1;
  width: number;
  reduced: boolean;
  /** Where a swiped card was let go (0 for buttons and keys). */
  offset: number;
}

/**
 * The stage's current movement, shared with every card on it — including a
 * card that is leaving, whose own props are frozen at the moment it left.
 * `generation` counts card changes, so a leaving card can tell it has been
 * overtaken by another.
 */
export const CardStage = createContext<{ generation: number; motion: CardMotion }>({
  generation: 0,
  motion: { direction: 0, width: 0, reduced: false, offset: 0 },
});

export interface Pose {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  /** The whole card. */
  opacity: number;
  /** What is printed on it (both sides' content), over the paper. */
  ink: number;
}

export const RESTING: Pose = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, ink: 1 };

/**
 * Where the incoming card starts: just behind and beneath the card being moved
 * away, already solid — it is revealed, not faded in. Next brings it from the
 * left of centre (the outgoing card goes right), Previous from the right.
 */
export function enterFrom({ direction, reduced }: CardMotion): Pose {
  return reduced || direction === 0
    ? RESTING
    : { x: -direction * 10, y: 10, rotate: -direction, scale: 0.97, opacity: 1, ink: 1 };
}

const between = ([from, to]: readonly [number, number]) => ({
  duration: NAV.duration,
  times: [0, from, to, 1],
  ease: "linear" as const,
});

/**
 * Where the outgoing card goes. Buttons and keys: aside to the right for
 * Next, to the left for Previous. A swipe: onward in the direction it was
 * thrown, from where it was let go, at the lean it had. It stays solid while
 * it moves, and leaves only once it is aside, over a card already nearly in
 * place: first its printing, then the blank paper. Reduced motion, or a change
 * with no direction (filter, restart): it fades where it is, over the new card.
 */
export function exitTo({ direction, width, reduced, offset }: CardMotion) {
  if (reduced || direction === 0) return { opacity: 0, transition: CROSSFADE };
  const side = offset !== 0 ? Math.sign(offset) : direction;
  const lean = width > 0 ? (offset / width) * DRAG_TILT : 0;
  return {
    x: offset + side * navShift(width),
    y: -4,
    rotate: lean + side * NAV_TILT,
    scale: 0.985,
    ink: [null, 1, 0, 0] as (number | null)[],
    opacity: [null, 1, 0, 0] as (number | null)[],
    transition: {
      ...NAV,
      ink: between(NAV_INK_FADE),
      opacity: between(NAV_PAPER_FADE),
    },
  };
}
