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
// On a phone, Next and Previous are the hand deck instead (below): the top
// card slides off — left for Next, right for Previous — uncovering the card
// already beneath it.
//
// The feel is a stiff card handled by hand: deliberate, never springy. Movement
// carries the meaning; opacity only supports it. A card is never faded to
// nothing in place, and there is never a frame without a card on the stage.
// The durations mirror --dur-flip and --dur-nav in src/styles.css (phones:
// MOBILE_FLIP and SLIDE, mirrored under the compact breakpoint there).

import { createContext } from "react";
import { motionValue, type MotionValue } from "framer-motion";

/** One whole turn, 0° → 180°: eases in, passes edge-on briskly, settles slowly. */
export const FLIP = { duration: 0.5, ease: [0.4, 0, 0.2, 1] } as const;

/**
 * A card change. Both cards move together for the whole of it: the outgoing
 * one aside, the incoming one forward from the stack.
 */
export const NAV = { duration: 0.44, ease: [0.25, 0.8, 0.3, 1] } as const;

/**
 * Phones only (the compact layout). On a small screen the flip reads as
 * landing abruptly, so it finishes more gently. Desktop keeps FLIP.
 *
 * The flip passes edge-on a little sooner and spends longer settling: the new
 * side is up earlier and eases into place rather than arriving at the end.
 */
export const MOBILE_FLIP = { duration: 0.54, ease: [0.3, 0.3, 0.15, 1] } as const;

/**
 * Phones only: once a flip's new side is substantially in view, its printing
 * resolves — from a hair lighter and lower to rest. The paper never fades.
 */
export const MOBILE_RESOLVE = { duration: 0.15, opacity: 0.95, lift: 2, ease: [0.2, 0, 0.2, 1] } as const;

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

// ------------------------------------------------- phones: the hand deck --
//
// On a phone the deck is held in the hand. The card on top is the one you
// read; the card it will change to is already beneath it. Swiping slides the
// top card off — left for Next, right for Previous — uncovering the card
// beneath, which stays where it is. Buttons and keys make the same movement.
// Nothing fades: the top card leaves by moving, and the card beneath is simply
// there.

/** The card beneath while fully covered: a hair smaller and lower. */
export const UNDER_DEPTH = { scale: 0.985, y: 3 } as const;
/** The card beneath comes fully up once the top card is this share of its width aside. */
export const REVEAL_SPAN = 0.5;

/** The card beneath, `reveal` (0 covered … 1 uncovered) of the way up. */
export function underPose(reveal: number, reduced = false): Pose {
  const r = reduced ? 1 : Math.min(1, Math.max(0, reveal));
  return {
    x: 0,
    y: UNDER_DEPTH.y * (1 - r),
    rotate: 0,
    scale: UNDER_DEPTH.scale + (1 - UNDER_DEPTH.scale) * r,
    opacity: 1,
    ink: 1,
  };
}

/** A button or key: the top card slides off from rest. */
export const SLIDE = { duration: 0.42, ease: [0.32, 0, 0.2, 1] } as const;
/** A swipe let go short of a card change: back to centre, eased out, no bounce. */
export const SLIDE_RETURN = { duration: 0.22, ease: [0.2, 0.7, 0.3, 1] } as const;
/** The card beneath, and a card brought back, coming to rest. */
export const SLIDE_SETTLE = { duration: 0.36, ease: [0.25, 0.8, 0.3, 1] } as const;
/** A swiped card's lean: degrees per card width of travel, and its limit. */
export const SLIDE_DRAG_TILT = 5;
export const SLIDE_TILT = 3;
/** A thrown card leaves no faster than this and no slower than SLIDE. */
export const SLIDE_MIN_DURATION = 0.24;

export function slideLean(offset: number, width: number): number {
  if (width <= 0) return 0;
  return Math.max(-SLIDE_TILT, Math.min(SLIDE_TILT, (offset / width) * SLIDE_DRAG_TILT));
}

/**
 * Where a phone's top card goes: off the side it was pushed — left for Next,
 * right for Previous, or the way it was thrown — from exactly where it is, at
 * the speed it was let go. It stays solid; the stage's edge clips it.
 * `velocity` is the release speed in px/ms (0 for buttons and keys).
 */
export function slideOff({ direction, width, reduced, offset }: CardMotion, velocity = 0) {
  if (reduced || direction === 0) return { pose: { opacity: 0 }, transition: CROSSFADE };
  const side = offset !== 0 ? Math.sign(offset) : -direction;
  const x = side * (width * 1.15 + 60);
  const pose = { x, rotate: side * SLIDE_TILT };
  const speed = Math.sign(velocity) === side ? Math.abs(velocity) * 1000 : 0;
  if (offset === 0 || speed === 0) return { pose, transition: SLIDE };
  // Thrown: continue at the speed it was let go, then ease off.
  const distance = Math.abs(x - offset);
  const duration = Math.min(SLIDE.duration, Math.max(SLIDE_MIN_DURATION, (2.2 * distance) / speed));
  // A cubic-bezier's starting slope is y1/x1: match it to the release speed.
  const slope = (speed * duration) / distance;
  return { pose, transition: { duration, ease: [0.3, Math.min(1, 0.3 * slope), 0.4, 1] } };
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
export const CardStage = createContext<{
  generation: number;
  motion: CardMotion;
  /** Phones: how far the top card has uncovered the card beneath (0…1). */
  reveal: MotionValue<number>;
}>({
  generation: 0,
  motion: { direction: 0, width: 0, reduced: false, offset: 0 },
  reveal: motionValue(0),
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
