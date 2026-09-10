/**
 * The gesture rules, exactly.
 *
 * These are the numbers that decide whether a movement on the card is a tap,
 * a swipe, a flick, a vertical flip, or nothing. The component tests drive
 * real pointer events; this file pins the thresholds themselves, including the
 * velocity cases jsdom cannot time realistically.
 */

import { describe, expect, it } from "vitest";
import {
  AXIS_LOCK_DISTANCE,
  FLICK_MIN_DISTANCE,
  VERTICAL_FLIP_DISTANCE,
  VelocityTracker,
  classifyRelease,
  lockAxis,
  rubberBand,
  swipeDistanceThreshold,
  type ReleaseInput,
} from "@/lib/gestures";

const PHONE_CARD = 366; // a 390px phone minus gutters

function release(overrides: Partial<ReleaseInput>) {
  return classifyRelease({
    axis: "x",
    dx: 0,
    dy: 0,
    vx: 0,
    vy: 0,
    cardWidth: PHONE_CARD,
    canGoPrevious: true,
    canGoNext: true,
    verticalFlip: true,
    ...overrides,
  });
}

describe("axis locking", () => {
  it("waits for a real movement before deciding", () => {
    expect(lockAxis(3, 2)).toBeNull();
    expect(lockAxis(AXIS_LOCK_DISTANCE - 1, 0)).toBeNull();
  });

  it("locks to the dominant axis", () => {
    expect(lockAxis(-20, 4)).toBe("x");
    expect(lockAxis(3, -20)).toBe("y");
  });

  it("gives up on a diagonal smear instead of guessing", () => {
    expect(lockAxis(12, 11)).toBeNull(); // still short: keep watching
    expect(lockAxis(30, 28)).toBe("none"); // long and still ambiguous: ignore
  });
});

describe("horizontal swipes", () => {
  it("scales the distance needed with the card, within sensible bounds", () => {
    expect(swipeDistanceThreshold(0)).toBe(64);
    expect(swipeDistanceThreshold(PHONE_CARD)).toBeCloseTo(80.5, 0);
    expect(swipeDistanceThreshold(2000)).toBe(110);
  });

  it("navigates on a slow drag that travels far enough", () => {
    expect(release({ dx: -100, vx: -0.1 })).toBe("next");
    expect(release({ dx: 100, vx: 0.1 })).toBe("previous");
  });

  it("springs back from a tentative drag", () => {
    expect(release({ dx: -45, vx: -0.1 })).toBe("cancel");
  });

  it("navigates on a short flick", () => {
    expect(release({ dx: -45, vx: -0.8 })).toBe("next");
    expect(release({ dx: 40, vx: 0.6 })).toBe("previous");
  });

  it("never treats a twitch as a flick, however fast", () => {
    expect(release({ dx: -(FLICK_MIN_DISTANCE - 1), vx: -3 })).toBe("cancel");
  });

  it("cancels when the finger is pulled back toward the start on release", () => {
    expect(release({ dx: -120, vx: 0.5 })).toBe("cancel");
  });

  it("reports a swipe past either end of the deck as an edge, not a move", () => {
    expect(release({ dx: -120, canGoNext: false })).toBe("edge");
    expect(release({ dx: 120, canGoPrevious: false })).toBe("edge");
  });
});

describe("vertical swipes", () => {
  it("flip the card when they travel far enough, in either direction", () => {
    expect(release({ axis: "y", dy: -VERTICAL_FLIP_DISTANCE })).toBe("flip");
    expect(release({ axis: "y", dy: VERTICAL_FLIP_DISTANCE + 10 })).toBe("flip");
  });

  it("flip on a short, quick flick", () => {
    expect(release({ axis: "y", dy: -36, vy: -0.7 })).toBe("flip");
  });

  it("do nothing when short and slow", () => {
    expect(release({ axis: "y", dy: -30, vy: -0.1 })).toBe("cancel");
  });

  it("belong to the scroll when the card's content scrolls", () => {
    expect(release({ axis: "y", dy: -120, vy: -1, verticalFlip: false })).toBe("cancel");
  });
});

describe("everything else", () => {
  it("does nothing for an undecided or ambiguous gesture", () => {
    expect(release({ axis: null, dx: -200 })).toBe("cancel");
    expect(release({ axis: "none", dx: -200, dy: -190 })).toBe("cancel");
  });

  it("resists drags toward a card that is not there, more the further they go", () => {
    expect(Math.abs(rubberBand(-50))).toBeLessThan(50);
    expect(rubberBand(-50)).toBeLessThan(0);
    expect(rubberBand(400)).toBeGreaterThan(rubberBand(100));
    expect(rubberBand(10_000)).toBeLessThan(90);
  });
});

describe("release velocity", () => {
  it("measures the last ~100ms, not the whole gesture", () => {
    const tracker = new VelocityTracker();
    tracker.reset(0, 0, 0);
    tracker.add(10, 0, 100);
    tracker.add(110, 0, 200);

    expect(tracker.velocity().vx).toBeCloseTo(1, 5);
  });

  it("floors the time span at one frame so bursty input cannot divide by zero", () => {
    const tracker = new VelocityTracker();
    tracker.reset(0, 0, 0);
    tracker.add(32, 0, 1);

    expect(tracker.velocity().vx).toBe(2);
  });
});
