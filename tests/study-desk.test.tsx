/**
 * The redesigned study card: one physical flashcard with two sides, a stack
 * beneath it, and three movements that must not be confused — flip (same
 * card, other side), next and previous (a different card, in opposite
 * directions).
 *
 * jsdom neither lays out nor paints, so what the motion looks like is checked
 * in real browsers. What is pinned here is everything that is not pixels: the
 * targets each movement animates to, that state stays right however fast the
 * controls are pressed, how a card's text is classified for display, and that
 * only one side of one card is ever readable.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import {
  briefFontSize,
  displayFit,
  displayFontSize,
  splitAnswer,
} from "@/lib/flashcards/card-layout";
import {
  FLIP,
  KEY_REPEAT_INTERVAL_MS,
  MOBILE_FLIP,
  MOBILE_RESOLVE,
  NAV,
  NAV_INK_FADE,
  NAV_PAPER_FADE,
  SLIDE,
  SLIDE_MIN_DURATION,
  SLIDE_RETURN,
  UNDER_DEPTH,
  enterFrom,
  exitTo,
  navShift,
  slideLean,
  slideOff,
  underPose,
  type CardMotion,
} from "@/lib/motion";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { DEFAULT_FONT_SIZE, useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import { COMPACT_QUERY, REDUCED_MOTION_QUERY } from "@/lib/use-media-query";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const deck: FlashcardDeck = {
  slug: "upload-desk",
  title: "Desk Deck",
  cardCount: 5,
  chapters: [{ id: "Only", name: "Only", cardCount: 5 }],
  cards: [
    { id: 1, chapter: "Only", tags: [], front: "curious", back: "curious<hr id=answer>eager to learn or know about something." },
    { id: 2, chapter: "Only", tags: [], front: "<p>Front 2</p>", back: "<p>Back 2</p>" },
    { id: 3, chapter: "Only", tags: [], front: "<p>Front 3</p>", back: "<p>Back 3</p>" },
    { id: 4, chapter: "Only", tags: [], front: "<p>Front 4</p>", back: "<p>Back 4</p>" },
    { id: 5, chapter: "Only", tags: [], front: "<p>Front 5</p>", back: "<p>Back 5</p>" },
  ],
};

const originalMatchMedia = window.matchMedia;

function setMedia({ compact = false, reduced = false } = {}) {
  window.matchMedia = ((query: string) => ({
    matches: (query === COMPACT_QUERY && compact) || (query === REDUCED_MOTION_QUERY && reduced),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/** "Card 2 of 5", as the card reads it out. */
const position = () => within(screen.getByTestId("card-position")).getByText(/^Card \d/).textContent;
const isFlipped = () =>
  screen.getAllByTestId("card-flipper").at(-1)!.getAttribute("data-flipped") === "true";
const face = (side: "front" | "back") =>
  screen.getAllByTestId("card-flipper").at(-1)!.querySelector<HTMLElement>(`[data-face="${side}"]`)!;

async function settle() {
  await waitFor(() => expect(screen.getAllByTestId("card-surface")).toHaveLength(1));
}

beforeEach(() => {
  localStorage.clear();
  useFlashcardsStore.setState({ knownByDeck: {} });
  useFlashcardPrefsStore.setState({
    font: "serif",
    fontSize: DEFAULT_FONT_SIZE,
    controlMode: "gestures",
    gestureHintSeen: true,
  });
  setMedia();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
});

describe("the three movements are different movements", () => {
  const base: CardMotion = { direction: 1, width: 640, reduced: false, offset: 0 };
  /** An exit that travels (as opposed to the fade used for reduced motion). */
  const moved = (target: ReturnType<typeof exitTo>) =>
    target as { x: number; y: number; rotate: number; opacity: (number | null)[] };

  it("Next moves the card a short way aside to the right; Previous, to the left", () => {
    const next = moved(exitTo({ ...base, direction: 1 }));
    const previous = moved(exitTo({ ...base, direction: -1 }));

    expect(next.x).toBeGreaterThan(0);
    expect(next.rotate).toBeGreaterThan(0);
    expect(previous.x).toBe(-next.x);
    expect(previous.rotate).toBe(-next.rotate);
    // Aside, not across: a fraction of the card's own width, and it fades.
    expect(Math.abs(next.x)).toBeLessThanOrEqual(640 * 0.25);
    expect(Math.abs(next.rotate)).toBeLessThanOrEqual(8);
    expect(next.opacity.at(-1)).toBe(0);
  });

  it("keeps the travel restrained on any card size", () => {
    for (const width of [0, 320, 390, 640, 960, 1600]) {
      const { x } = moved(exitTo({ ...base, width }));
      expect(x).toBeGreaterThanOrEqual(48);
      expect(x).toBeLessThanOrEqual(120);
    }
  });

  it("brings the incoming card forward from the stack, not in from the far side", () => {
    const next = enterFrom({ ...base, direction: 1 });
    const previous = enterFrom({ ...base, direction: -1 });

    expect(next.scale).toBeLessThan(1);
    expect(next.y).toBeGreaterThan(0);
    expect(Math.abs(next.x)).toBeLessThan(20);
    expect(previous.x).toBe(-next.x);
  });

  it("lets a swiped card continue the way it was thrown, from where it was let go", () => {
    expect(moved(exitTo({ ...base, direction: 1, offset: -90 })).x).toBeLessThan(-90);
    expect(moved(exitTo({ ...base, direction: -1, offset: 90 })).x).toBeGreaterThan(90);
  });

  it("with reduced motion neither travels nor turns: the old card fades over the new one", () => {
    const out = exitTo({ ...base, reduced: true });
    const incoming = enterFrom({ ...base, reduced: true });

    expect(out).toEqual({ opacity: 0, transition: { duration: 0.12 } });
    // Already in place and solid beneath: no frame without a card.
    expect(incoming).toEqual({ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, ink: 1 });
  });

  it("is deliberate, not snappy: a flip of 450–550ms, a card change of 380–480ms", () => {
    expect(FLIP.duration * 1000).toBeGreaterThanOrEqual(450);
    expect(FLIP.duration * 1000).toBeLessThanOrEqual(550);
    expect(NAV.duration * 1000).toBeGreaterThanOrEqual(380);
    expect(NAV.duration * 1000).toBeLessThanOrEqual(480);
  });

  it("on phones flips more gently, without changing the desktop timings", () => {
    // Desktop as it was.
    expect(FLIP).toEqual({ duration: 0.5, ease: [0.4, 0, 0.2, 1] });
    expect(NAV).toEqual({ duration: 0.44, ease: [0.25, 0.8, 0.3, 1] });
    // Phones: a flip of 500–560ms, ending without overshoot.
    expect(MOBILE_FLIP.duration * 1000).toBeGreaterThanOrEqual(500);
    expect(MOBILE_FLIP.duration * 1000).toBeLessThanOrEqual(560);
    expect(MOBILE_FLIP.ease[3]).toBeLessThanOrEqual(1);
    // Only the printing of a flip's new side resolves, and only a hair.
    expect(MOBILE_RESOLVE.opacity).toBeGreaterThanOrEqual(0.92);
    expect(MOBILE_RESOLVE.lift).toBeLessThanOrEqual(2);
  });

  describe("on a phone, the deck is held in the hand", () => {
    const phone: CardMotion = { direction: 1, width: 358, reduced: false, offset: 0 };

    it("Next slides the top card off to the left, Previous to the right, solid all the way", () => {
      const next = slideOff({ ...phone, direction: 1 });
      const previous = slideOff({ ...phone, direction: -1 });
      const nx = (next.pose as { x: number }).x;
      // Clear of a phone screen: the stage's edge clips it.
      expect(nx).toBeLessThan(-358);
      expect((previous.pose as { x: number }).x).toBe(-nx);
      expect(Math.abs((next.pose as { rotate: number }).rotate)).toBeLessThanOrEqual(3);
      // Nothing fades: the card leaves by moving.
      expect(next.pose).not.toHaveProperty("opacity");
      // A button press: 350–450ms.
      expect(next.transition).toBe(SLIDE);
      expect(SLIDE.duration * 1000).toBeGreaterThanOrEqual(350);
      expect(SLIDE.duration * 1000).toBeLessThanOrEqual(450);
    });

    it("a thrown card carries on from where it was let go, at the speed it was let go", () => {
      const thrown = slideOff({ ...phone, offset: -135 }, -1.2);
      const x = (thrown.pose as { x: number }).x;
      const { duration, ease } = thrown.transition as { duration: number; ease: number[] };
      expect(x).toBeLessThan(-135);
      expect(duration).toBeGreaterThanOrEqual(SLIDE_MIN_DURATION);
      expect(duration).toBeLessThanOrEqual(SLIDE.duration);
      // Its starting speed (the curve's starting slope × distance / duration) is the release speed.
      const start = ((ease[1] / ease[0]) * Math.abs(x + 135)) / (duration * 1000);
      expect(start).toBeCloseTo(1.2, 1);
      // A slow, long drag past the threshold leaves at the button's pace.
      expect(slideOff({ ...phone, offset: -120 }, 0).transition).toBe(SLIDE);
    });

    it("the card beneath sits a hair down until uncovered; a cancelled swipe eases back without bouncing", () => {
      expect(underPose(0)).toEqual({ x: 0, y: UNDER_DEPTH.y, rotate: 0, scale: UNDER_DEPTH.scale, opacity: 1, ink: 1 });
      expect(underPose(1)).toEqual({ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, ink: 1 });
      expect(underPose(0, true)).toEqual(underPose(1));
      expect(UNDER_DEPTH.scale).toBeGreaterThanOrEqual(0.98);
      expect(SLIDE_RETURN.duration * 1000).toBeGreaterThanOrEqual(180);
      expect(SLIDE_RETURN.duration * 1000).toBeLessThanOrEqual(260);
      expect(SLIDE_RETURN.ease[3]).toBeLessThanOrEqual(1);
      // A small lean only.
      expect(Math.abs(slideLean(-400, 358))).toBeLessThanOrEqual(3);
      expect(slideLean(-60, 358)).toBeLessThan(0);
    });

    it("with reduced motion a phone's card change is a short fade over the card beneath, not a slide", () => {
      expect(slideOff({ ...phone, reduced: true }, -2)).toEqual({ pose: { opacity: 0 }, transition: { duration: 0.12 } });
    });

    const finger = { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0 };
    const under = () => screen.queryByTestId("card-under");

    it("puts the next card beneath while dragging left, and promotes that same card on release", async () => {
      setMedia({ compact: true });
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
      const top = screen.getByTestId("card-surface");
      fireEvent.pointerDown(top, { ...finger, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 185, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 120, clientY: 300 });

      // Mid-drag: the next card is already mounted beneath, printed, front up.
      const beneath = under()!;
      expect(beneath).not.toBeNull();
      expect(beneath).toHaveAttribute("data-deck", "under");
      expect(beneath).toHaveAttribute("aria-hidden", "true");
      expect(within(beneath).getByText("Front 2")).toBeInTheDocument();
      expect(Number(beneath.style.zIndex)).toBeLessThan(Number(top.style.zIndex));
      expect(position()).toBe("Card 1 of 5");

      fireEvent.pointerUp(top, { ...finger, clientX: 120, clientY: 300 });
      await settle();
      // The card that was beneath is now the card: the same element, not a re-render.
      expect(screen.getByTestId("card-surface")).toBe(beneath);
      expect(beneath).toHaveAttribute("data-deck", "top");
      expect(position()).toBe("Card 2 of 5");
      expect(under()).toBeNull();
    });

    it("puts the previous card beneath while dragging right", async () => {
      setMedia({ compact: true });
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
      fireEvent.keyDown(window, { key: "ArrowRight" });
      await settle();
      const top = screen.getByTestId("card-surface");
      fireEvent.pointerDown(top, { ...finger, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 215, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 290, clientY: 300 });
      const front = under()!.querySelector<HTMLElement>('[data-face="front"]')!;
      expect(within(front).getByText("curious")).toBeInTheDocument();
      fireEvent.pointerUp(top, { ...finger, clientX: 290, clientY: 300 });
      await settle();
      expect(position()).toBe("Card 1 of 5");
    });

    it("a short drag puts the top card back, and the card beneath goes once covered", async () => {
      setMedia({ compact: true });
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
      const top = screen.getByTestId("card-surface");
      fireEvent.pointerDown(top, { ...finger, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 188, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 170, clientY: 300 });
      expect(under()).not.toBeNull();
      fireEvent.pointerUp(top, { ...finger, clientX: 170, clientY: 300 });
      await waitFor(() => expect(under()).toBeNull());
      expect(screen.getByTestId("card-surface")).toBe(top);
      expect(position()).toBe("Card 1 of 5");
    });

    it("puts nothing beneath on a larger screen: the desk keeps its own movement", () => {
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
      const top = screen.getByTestId("card-surface");
      fireEvent.pointerDown(top, { ...finger, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 185, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 120, clientY: 300 });
      expect(under()).toBeNull();
      expect(top).not.toHaveAttribute("data-deck");
      fireEvent.pointerUp(top, { ...finger, clientX: 120, clientY: 300 });
    });
  });

  it("never fades a card to nothing in place: movement first, a dissolve only once aside", () => {
    // The incoming card is revealed already solid, not faded in.
    expect(enterFrom({ ...base, direction: 1 }).opacity).toBe(1);
    expect(enterFrom({ ...base, direction: -1 }).opacity).toBe(1);

    type Fade = { times: number[]; duration: number };
    const out = exitTo({ ...base, direction: 1 }) as {
      opacity: (number | null)[];
      ink: (number | null)[];
      scale: number;
      transition: { duration: number; opacity: Fade; ink: Fade };
    };
    // Fully solid while it travels: no translucent card showing the next card's text through it.
    expect(out.opacity).toEqual([null, 1, 0, 0]);
    expect(out.ink).toEqual([null, 1, 0, 0]);
    expect(NAV_PAPER_FADE[0]).toBeGreaterThanOrEqual(0.5);
    // Its printing is gone before its paper starts to go: two texts are never legible together.
    expect(NAV_INK_FADE[0]).toBeLessThan(NAV_INK_FADE[1]);
    expect(NAV_INK_FADE[1]).toBeLessThanOrEqual(NAV_PAPER_FADE[0]);
    expect(out.transition.opacity.times).toEqual([0, ...NAV_PAPER_FADE, 1]);
    expect(out.transition.ink.times).toEqual([0, ...NAV_INK_FADE, 1]);
    // Both fades run on the move's own clock: both cards move for all of it.
    expect(out.transition.opacity.duration).toBe(out.transition.duration);
    expect(out.transition.ink.duration).toBe(out.transition.duration);
    expect(out.scale).toBeGreaterThan(0.97);
  });

  it("moves a phone-sized card 48–64px aside, not across the screen", () => {
    expect(navShift(358)).toBeGreaterThanOrEqual(48);
    expect(navShift(358)).toBeLessThanOrEqual(64);
    expect(navShift(1600)).toBe(64);
  });

  it("lets a swiped card keep the lean it was thrown with", () => {
    const thrown = moved(exitTo({ ...base, direction: 1, offset: -160 }));
    const pressed = moved(exitTo({ ...base, direction: 1 }));
    expect(thrown.rotate).toBeLessThan(-Math.abs(pressed.rotate));
  });

  it("a flip turns the card and leaves its position alone; a move leaves it unturned", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const before = screen.getByTestId("card-surface");

    fireEvent.keyDown(window, { key: " " });
    expect(isFlipped()).toBe(true);
    expect(position()).toBe("Card 1 of 5");
    // The same element: a flip is never a different card.
    expect(screen.getByTestId("card-surface")).toBe(before);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    expect(screen.getByTestId("card-surface")).not.toBe(before);
    expect(isFlipped()).toBe(false);
    expect(screen.getByTestId("card-flipper")).toHaveAttribute("data-painted", "front");
  });
});

describe("one card, one side", () => {
  it("exposes exactly one face, and the other is hidden and inert", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(face("front")).not.toHaveAttribute("aria-hidden");
    expect(face("back")).toHaveAttribute("aria-hidden", "true");
    expect(face("back")).toHaveAttribute("inert");

    fireEvent.keyDown(window, { key: " " });
    expect(face("front")).toHaveAttribute("aria-hidden", "true");
    expect(face("front")).toHaveAttribute("inert");
    expect(face("back")).not.toHaveAttribute("aria-hidden");
  });

  it("draws the rest of the deck as blank silhouettes: as many as remain, at most three", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    const stack = () => screen.queryAllByTestId("deck-stack");
    expect(stack()).toHaveLength(3);
    for (const sheet of stack()) {
      expect(sheet).toHaveAttribute("aria-hidden", "true");
      expect(sheet).toBeEmptyDOMElement();
    }

    for (const expected of [3, 2, 1, 0]) {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      await settle();
      expect(stack()).toHaveLength(expected);
    }
  });

  it("gives a phone the card alone: no stack, no margin notes", () => {
    setMedia({ compact: true });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.queryAllByTestId("deck-stack")).toHaveLength(0);
    expect(screen.getAllByTestId("card-surface")).toHaveLength(1);
  });

  it("is a real two-sided card: both sides of cardstock, mounted back to back in one turning container", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const flipper = screen.getByTestId("card-flipper");
    const front = flipper.querySelector<HTMLElement>(':scope > [data-side="front"]')!;
    const back = flipper.querySelector<HTMLElement>(':scope > [data-side="back"]')!;

    expect(flipper).toHaveClass("card-flipper");
    expect(flipper.style.transform).toBe("rotateY(0deg)");
    for (const side of [front, back]) expect(side).toHaveClass("paper", "card-side");
    expect(back).toHaveClass("paper-back");
    expect(front.style.transform).toBe("rotateY(0deg)");
    expect(back.style.transform).toBe("rotateY(180deg)");
    expect(front).toContainElement(face("front"));
    expect(back).toContainElement(face("back"));
    // Perspective on the turning card's parent, not on the card.
    expect(flipper.parentElement!.style.perspective).toMatch(/^\d+px$/);
  });

  it("turns the same elements over: nothing is remounted or replaced by a flip", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const flipper = screen.getByTestId("card-flipper");
    const front = face("front");
    const back = face("back");

    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(flipper).toHaveAttribute("data-painted", "back"));
    expect(flipper.style.transform).toBe("rotateY(180deg)");
    expect(face("front")).toBe(front);
    expect(face("back")).toBe(back);

    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(flipper).toHaveAttribute("data-painted", "front"));
    expect(flipper.style.transform).toBe("rotateY(0deg)");
    expect(screen.getByTestId("card-flipper")).toBe(flipper);
  });

  it("names the card's position once, from the side that is up", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    expect(screen.getAllByTestId("card-position")).toHaveLength(1);
    expect(face("front").closest("[data-side]")).toContainElement(screen.getByTestId("card-position"));

    fireEvent.keyDown(window, { key: " " });
    expect(screen.getAllByTestId("card-position")).toHaveLength(1);
    expect(face("back").closest("[data-side]")).toContainElement(screen.getByTestId("card-position"));
  });
});

describe("rapid input", () => {
  it("counts every press exactly once, however fast Next and Previous alternate", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    // No waiting between presses: every one lands mid-animation.
    for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight"]) {
      fireEvent.keyDown(window, { key });
    }
    expect(position()).toBe("Card 4 of 5");
    await settle();

    expect(screen.getAllByTestId("card-flipper")).toHaveLength(1);
    expect(screen.getByText("Front 4")).toBeInTheDocument();
    expect(screen.queryByText("Front 3")).toBeNull();
    expect(isFlipped()).toBe(false);
  });

  it("never runs off either end, and never leaves a second card behind", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    for (let i = 0; i < 12; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(position()).toBe("Card 5 of 5");
    for (let i = 0; i < 12; i++) fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(position()).toBe("Card 1 of 5");

    await settle();
    expect(screen.getByText("curious", { selector: "[data-face='front'] *" })).toBeInTheDocument();
  });

  it("keeps the face and the flag in step through a burst of flips", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const flip = screen.getByRole("button", { name: "Flip" });

    for (let i = 0; i < 7; i++) fireEvent.click(flip);
    expect(isFlipped()).toBe(true);
    expect(position()).toBe("Card 1 of 5");
    await waitFor(() =>
      expect(screen.getByTestId("card-flipper")).toHaveAttribute("data-painted", "back")
    );

    await user.click(flip);
    expect(isFlipped()).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId("card-flipper")).toHaveAttribute("data-painted", "front")
    );
  });

  it("flipping and moving in the same breath shows the next card's front, not a stale answer", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();

    expect(position()).toBe("Card 3 of 5");
    expect(isFlipped()).toBe(false);
    expect(face("front")).toHaveTextContent("Front 3");
    expect(face("back")).toHaveTextContent("Back 3");
    expect(screen.getByTestId("card-flipper")).toHaveAttribute("data-painted", "front");
  });

  it("a held flip key flips once", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: " " });
    for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { key: " ", repeat: true });

    expect(isFlipped()).toBe(true);
  });

  it("a held arrow key steps at a readable pace instead of racing through the deck", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(position()).toBe("Card 2 of 5");

    // Thirty auto-repeats inside one interval move one more card, not thirty.
    for (let i = 0; i < 30; i++) {
      now += 1;
      fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    }
    expect(position()).toBe("Card 3 of 5");

    now += KEY_REPEAT_INTERVAL_MS;
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    expect(position()).toBe("Card 4 of 5");
  });

  it("still works, without the turn or the travel, when motion is reduced", async () => {
    setMedia({ reduced: true });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    for (const key of ["ArrowRight", " ", "ArrowRight", "ArrowLeft"]) fireEvent.keyDown(window, { key });
    await settle();

    expect(position()).toBe("Card 2 of 5");
    expect(isFlipped()).toBe(false);
    expect(screen.getByTestId("card-flipper").style.transform).toBe("rotateY(0deg)");
  });
});

describe("how a card's text is set", () => {
  it("treats a short plain term as display type, larger the shorter it is", () => {
    const word = displayFit("curious")!;
    const phrase = displayFit("<p>What does <b>OSI</b> stand for?</p>")!;
    const sentence = displayFit("How many layers does the OSI model have, counting from the bottom?")!;

    expect(word.lines).toBe(1);
    expect(phrase.lines).toBe(2);
    expect(sentence.lines).toBeGreaterThanOrEqual(3);
    // More characters per line means a smaller size: it eases down, never jumps to tiny.
    expect(word.chars).toBeLessThan(phrase.chars);
    expect(phrase.chars).toBeLessThanOrEqual(sentence.chars);
  });

  it("leaves long text, media, lists and tables as a document at the reader's size", () => {
    expect(displayFit("x".repeat(120))).toBeNull();
    expect(displayFit('Which topology?<br><img src="diagram.png">')).toBeNull();
    expect(displayFit("<ul><li>one</li></ul>")).toBeNull();
    expect(displayFit("<table><tr><td>a</td></tr></table>")).toBeNull();
    expect(displayFit("")).toBeNull();
    expect(briefFontSize("<table><tr><td>a</td></tr></table>", 19)).toBe("19px");
    expect(briefFontSize("y".repeat(400), 19)).toBe("19px");
  });

  it("never sets display type below the reader's chosen size, or above the cap", () => {
    expect(displayFontSize({ chars: 7, lines: 1 }, 19)).toBe("clamp(19px, min(18.29cqw, 44.00cqh), 6.5rem)");
    expect(displayFontSize({ chars: 30, lines: 3 }, 22, 2.1)).toMatch(/^clamp\(22px, .*, 2\.1rem\)$/);
  });

  it("marks the front of a term card as display type, and not the back", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(face("front").querySelector(".anki-card-content")).toHaveClass("card-display");
    expect(face("back").querySelector(".anki-card-content")).not.toHaveClass("card-display");
  });

  it("sets a back that repeats the question as title, rule, answer — from the card's own HTML", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const back = within(face("back"));

    expect(back.getByText("curious")).toHaveClass("card-term");
    expect(back.getByText("eager to learn or know about something.")).toHaveClass("card-answer");
    expect(face("back").querySelectorAll("hr")).toHaveLength(1);
  });

  it("invents nothing: HTML without that shape is left exactly as it is", () => {
    expect(splitAnswer("<p>Just an answer</p>")).toBe("<p>Just an answer</p>");
    expect(splitAnswer("<hr>Only after")).toBe("<hr>Only after");
    expect(splitAnswer("Only before<hr>")).toBe("Only before<hr>");
    // A rule nested inside something else is not the question/answer divider.
    expect(splitAnswer("<div>a<hr>b</div>")).toBe("<div>a<hr>b</div>");
    expect(splitAnswer("Q<hr>A")).toBe('<div class="card-term">Q</div><hr><div class="card-answer">A</div>');
  });
});
