/**
 * The card's gesture rules, as pure functions.
 *
 * Kept apart from the component so the thresholds can be tested exactly and
 * read in one place. The model is:
 *
 *   horizontal movement navigates   (left = next, right = previous)
 *   a tap, or a clear vertical swipe, flips
 *
 * Nothing overloads horizontal movement with flipping, and a gesture that is
 * too diagonal to call does nothing at all rather than guessing.
 */

/** Movement a tap may include (finger jitter) and still count as a tap. */
export const TAP_SLOP = 8;

/** Movement before the gesture commits to an axis. */
export const AXIS_LOCK_DISTANCE = 10;

/**
 * Past this, a movement that is still roughly 45° is declared ambiguous and
 * ignored — a diagonal smear should neither navigate nor flip.
 */
export const AMBIGUOUS_DISTANCE = 24;

/** How much more one axis must dominate the other to win the lock. */
export const AXIS_DOMINANCE = 1.2;

/** A flick needs this much travel as well as speed, so a twitch is never a flick. */
export const FLICK_MIN_DISTANCE = 32;

/** px/ms. Roughly a brisk flick; a slow drag stays well under it. */
export const FLICK_MIN_VELOCITY = 0.45;

/** Moving back toward the start at this speed on release reads as "never mind". */
export const REVERSAL_VELOCITY = 0.3;

/** Vertical travel that flips the card without needing a flick. */
export const VERTICAL_FLIP_DISTANCE = 56;

export type Axis = "x" | "y";
export type AxisLock = Axis | "none" | null;

/**
 * Decides which axis a movement belongs to.
 *   null   — not enough movement yet to tell
 *   "none" — moved a fair way but too diagonally to call; ignore the gesture
 */
export function lockAxis(dx: number, dy: number): AxisLock {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const travel = Math.max(ax, ay);
  if (travel < AXIS_LOCK_DISTANCE) return null;
  if (ax >= ay * AXIS_DOMINANCE) return "x";
  if (ay >= ax * AXIS_DOMINANCE) return "y";
  return travel >= AMBIGUOUS_DISTANCE ? "none" : null;
}

/**
 * Distance that commits a horizontal swipe without a flick: about a fifth of
 * the card, never less than 64px (tiny cards, tests) and never more than 110px
 * (so a wide desktop card does not demand a long drag).
 */
export function swipeDistanceThreshold(cardWidth: number): number {
  return Math.min(110, Math.max(64, cardWidth * 0.22));
}

export type ReleaseOutcome = "next" | "previous" | "flip" | "edge" | "cancel";

export interface ReleaseInput {
  axis: AxisLock;
  dx: number;
  dy: number;
  /** Release velocity in px/ms. */
  vx: number;
  vy: number;
  cardWidth: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  /** False when the card's content scrolls: vertical movement then belongs to the scroll. */
  verticalFlip: boolean;
}

/**
 * What a released gesture means.
 *
 * "edge" is a committed swipe toward a card that does not exist (past either
 * end of the deck): the card springs back and the UI may say why.
 */
export function classifyRelease(input: ReleaseInput): ReleaseOutcome {
  const { axis, dx, dy, vx, vy } = input;

  if (axis === "x") {
    const distance = Math.abs(dx);
    // Pulling back toward the start while letting go: the user changed their mind.
    if (Math.sign(vx) === -Math.sign(dx) && Math.abs(vx) >= REVERSAL_VELOCITY) return "cancel";

    const flick =
      distance >= FLICK_MIN_DISTANCE &&
      Math.abs(vx) >= FLICK_MIN_VELOCITY &&
      Math.sign(vx) === Math.sign(dx);
    if (distance < swipeDistanceThreshold(input.cardWidth) && !flick) return "cancel";

    if (dx < 0) return input.canGoNext ? "next" : "edge";
    return input.canGoPrevious ? "previous" : "edge";
  }

  if (axis === "y" && input.verticalFlip) {
    const distance = Math.abs(dy);
    const flick =
      distance >= FLICK_MIN_DISTANCE &&
      Math.abs(vy) >= FLICK_MIN_VELOCITY &&
      Math.sign(vy) === Math.sign(dy);
    return distance >= VERTICAL_FLIP_DISTANCE || flick ? "flip" : "cancel";
  }

  return "cancel";
}

/**
 * Resistance for dragging toward a card that is not there: the card follows,
 * but less and less, like pulling against a spring.
 */
export function rubberBand(offset: number, limit = 90): number {
  const magnitude = Math.abs(offset);
  return Math.sign(offset) * limit * (1 - 1 / ((magnitude * 0.55) / limit + 1));
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

/**
 * Release velocity from the last ~100ms of movement.
 *
 * Measured over a short window rather than the whole gesture, so a slow drag
 * that ends in a flick counts as a flick — and a flick that stopped before
 * release does not.
 */
export class VelocityTracker {
  private samples: Sample[] = [];

  reset(x: number, y: number, t: number): void {
    this.samples = [{ x, y, t }];
  }

  add(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    const cutoff = t - 100;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** px/ms. The time span is floored at one frame so bursty input cannot divide by ~0. */
  velocity(): { vx: number; vy: number } {
    if (this.samples.length < 2) return { vx: 0, vy: 0 };
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = Math.max(16, last.t - first.t);
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }
}
