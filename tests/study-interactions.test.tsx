/**
 * How the study screen is operated: touch gestures, the phone control modes,
 * tablet/desktop controls, the keyboard, reduced motion and what assistive
 * technology gets.
 *
 * Gestures are driven with real pointer-event sequences on the card — down, a
 * few moves, up, and the click a browser may deliver afterwards — so these run
 * the same handlers a finger does. jsdom performs no layout, so the card
 * measures 0px wide and the swipe threshold sits at its 64px floor; the exact
 * distance and velocity rules are pinned in gestures.test.ts.
 *
 * Layout is chosen with media queries, so each test states the environment it
 * simulates (phone-sized, larger, reduced motion, mouse) through matchMedia.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { DEFAULT_FONT_SIZE, useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import { COMPACT_QUERY, FINE_POINTER_QUERY, REDUCED_MOTION_QUERY } from "@/lib/use-media-query";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const deck: FlashcardDeck = {
  slug: "upload-gestures",
  title: "Gesture Deck",
  cardCount: 4,
  chapters: [{ id: "Only", name: "Only", cardCount: 4 }],
  cards: [1, 2, 3, 4].map((n) => ({
    id: n,
    chapter: "Only",
    tags: [],
    front: `<p>Front ${n}</p>`,
    back: `<p>Back ${n}</p>`,
  })),
};

const originalMatchMedia = window.matchMedia;

function setMedia({ compact = false, reduced = false, fine = false } = {}) {
  window.matchMedia = ((query: string) => ({
    matches:
      (query === COMPACT_QUERY && compact) ||
      (query === REDUCED_MOTION_QUERY && reduced) ||
      (query === FINE_POINTER_QUERY && fine),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const counter = () =>
  screen.getByTestId("card-counter").textContent?.replace(/\s+/g, " ").trim();

function isFlipped() {
  const flippers = screen.getAllByTestId("card-flipper");
  return flippers[flippers.length - 1].getAttribute("data-flipped") === "true";
}

/** The card currently on top (an outgoing card may still be leaving). */
const card = () => screen.getAllByTestId("card-surface").at(-1)!;

async function settle() {
  await waitFor(() => expect(screen.getAllByTestId("card-surface")).toHaveLength(1));
}

/**
 * A finger on the card: down, `steps` moves to (dx, dy), up — then the click a
 * browser may send after the pointer is released, which must never flip a
 * card that was swiped.
 */
function drag(target: Element, { dx = 0, dy = 0, steps = 5 } = {}) {
  const pointer = { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0 };
  const x0 = 200;
  const y0 = 320;
  fireEvent.pointerDown(target, { ...pointer, clientX: x0, clientY: y0 });
  for (let i = 1; i <= steps; i++) {
    fireEvent.pointerMove(target, {
      ...pointer,
      clientX: x0 + (dx * i) / steps,
      clientY: y0 + (dy * i) / steps,
    });
  }
  fireEvent.pointerUp(target, { ...pointer, clientX: x0 + dx, clientY: y0 + dy });
  fireEvent.click(target, { clientX: x0 + dx, clientY: y0 + dy });
}

async function openOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Study options" }));
  return screen.findByRole("dialog", { name: "Study options" });
}

async function closeOptions() {
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  localStorage.clear();
  useFlashcardsStore.setState({ knownByDeck: {} });
  useFlashcardPrefsStore.setState({
    font: "sans",
    fontSize: DEFAULT_FONT_SIZE,
    controlMode: "gestures",
    gestureHintSeen: false,
  });
  setMedia();
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

describe("touch gestures on the card", () => {
  it("tap flips the card, and tapping again flips it back", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(card());
    expect(isFlipped()).toBe(true);

    await user.click(card());
    expect(isFlipped()).toBe(false);
  });

  it("swipe left moves to the next card", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dx: -150 });
    await settle();

    expect(counter()).toBe("2 / 4");
    expect(screen.getByText("Front 2")).toBeInTheDocument();
  });

  it("swipe right moves back to the previous card", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    expect(counter()).toBe("2 / 4");

    drag(card(), { dx: 150 });
    await settle();

    expect(counter()).toBe("1 / 4");
    expect(screen.getByText("Front 1")).toBeInTheDocument();
  });

  it("swipe up or down flips the card", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dy: -90 });
    expect(isFlipped()).toBe(true);

    drag(card(), { dy: 90 });
    expect(isFlipped()).toBe(false);
    expect(counter()).toBe("1 / 4");
  });

  it("a small horizontal movement does not change the card", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dx: -20 });

    expect(counter()).toBe("1 / 4");
    expect(isFlipped()).toBe(false);
  });

  it("a small drag that is released does not count as a tap", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dx: 12, steps: 2 });

    expect(isFlipped()).toBe(false);
    expect(counter()).toBe("1 / 4");
  });

  it("a tap with a little finger jitter still flips", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dx: 4, dy: 3, steps: 1 });

    expect(isFlipped()).toBe(true);
  });

  it("a committed swipe does not also flip the card", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dx: -150 });
    await settle();

    expect(counter()).toBe("2 / 4");
    expect(isFlipped()).toBe(false);
  });

  it("a diagonal smear neither moves nor flips", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dx: -40, dy: 38 });

    expect(counter()).toBe("1 / 4");
    expect(isFlipped()).toBe(false);
  });

  it("keeps flipping reliably across repeated swipes", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    for (const expected of ["2 / 4", "3 / 4", "4 / 4"]) {
      drag(card(), { dx: -150 });
      await settle();
      expect(counter()).toBe(expected);
      expect(isFlipped()).toBe(false);

      await user.click(card());
      expect(isFlipped()).toBe(true);
    }

    drag(card(), { dx: 150 });
    await settle();
    expect(counter()).toBe("3 / 4");
    expect(isFlipped()).toBe(false);
  });

  it("springs back at either end of the deck and says why", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dx: 150 });
    expect(counter()).toBe("1 / 4");
    expect(await screen.findByText("This is the first card.")).toBeInTheDocument();

    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    drag(card(), { dx: -150 });
    expect(counter()).toBe("4 / 4");
    expect(await screen.findByText("That's the last card.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restart" }));
    await settle();
    expect(counter()).toBe("1 / 4");
  });

  it("leaves vertical movement to a card whose content scrolls", async () => {
    // jsdom has no layout; give card scroll areas a long content height.
    const originals = {
      scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
      clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
    };
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("card-scroll") ? 1200 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("card-scroll") ? 400 : 0;
      },
    });

    try {
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

      // The browser is allowed to pan vertically here, so the content scrolls…
      expect(card().style.touchAction).toBe("pan-y");
      // …and a vertical swipe does not flip the card out from under the reader.
      drag(card(), { dy: -90 });
      expect(isFlipped()).toBe(false);
      // A scrollable region is reachable from the keyboard.
      expect(screen.getByRole("region", { name: /question, scrollable/i })).toHaveAttribute(
        "tabindex",
        "0"
      );

      // Horizontal swipes still navigate.
      drag(card(), { dx: -150 });
      await settle();
      expect(counter()).toBe("2 / 4");
    } finally {
      for (const [name, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      }
    }
  });

  it("carries the card's touch-action through the card's own scroll area", () => {
    // A touch's browser behaviour is resolved only up to the nearest scroll
    // container, and the card's content area is one. If it did not repeat the
    // card's touch-action, the browser would start panning inside the card and
    // cancel every swipe — which is exactly what happened in a real browser
    // before this was set. (jsdom has no touch pipeline to show the failure.)
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(card().style.touchAction).toBe("none");
    for (const area of card().querySelectorAll<HTMLElement>(".card-scroll")) {
      expect(area.style.touchAction).toBe(card().style.touchAction);
    }
  });

  it("leaves drags on a sideways-scrolling table to the table, but still flips on a tap", async () => {
    const tableDeck: FlashcardDeck = {
      ...deck,
      cards: [
        { ...deck.cards[0], front: "<table><tr><td>Wide table</td></tr></table>" },
        ...deck.cards.slice(1),
      ],
    };
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).tagName === "TABLE" ? 900 : 0;
      },
    });

    try {
      const user = userEvent.setup();
      render(<FlashcardViewer deck={tableDeck} onExit={vi.fn()} />);
      const cell = screen.getByText("Wide table");

      // A drag that starts on the table is the table's: even carried through
      // to release, it does not move the deck. (A browser scrolling the table
      // natively sends no click afterwards, so none is sent here.)
      const pointer = { pointerId: 9, pointerType: "touch", isPrimary: true, button: 0 };
      fireEvent.pointerDown(cell, { ...pointer, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(cell, { ...pointer, clientX: 120, clientY: 300 });
      fireEvent.pointerMove(cell, { ...pointer, clientX: 50, clientY: 300 });
      fireEvent.pointerUp(cell, { ...pointer, clientX: 50, clientY: 300 });
      expect(counter()).toBe("1 / 4");
      expect(isFlipped()).toBe(false);

      await user.click(cell);
      expect(isFlipped()).toBe(true);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollWidth", original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
    }
  });

  it("does not flip when a button on the card is pressed", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Mark known" }));

    expect(isFlipped()).toBe(false);
    expect(screen.getByText("1 known")).toBeInTheDocument();
  });
});

describe("phone-sized screens", () => {
  beforeEach(() => setMedia({ compact: true }));

  it("default to gestures: no button bar, the card gets the space", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.queryByTestId("control-bar")).not.toBeInTheDocument();
    expect(screen.getByTestId("gesture-hint")).toHaveTextContent(/swipe to move.*tap to flip/i);
  });

  it("keep Previous, Flip and Next available to keyboard and screen-reader users in gesture mode", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const controls = within(screen.getByRole("group", { name: "Card controls" }));

    await user.click(controls.getByRole("button", { name: "Next" }));
    expect(counter()).toBe("2 / 4");
    await user.click(controls.getByRole("button", { name: "Flip" }));
    expect(isFlipped()).toBe(true);
    await user.click(controls.getByRole("button", { name: "Previous" }));
    expect(counter()).toBe("1 / 4");
  });

  it("retire the gesture hint after the first gesture, for good", async () => {
    const user = userEvent.setup();
    const view = render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    expect(screen.getByTestId("gesture-hint")).toBeInTheDocument();

    await user.click(card());
    await waitFor(() => expect(screen.queryByTestId("gesture-hint")).not.toBeInTheDocument());
    expect(useFlashcardPrefsStore.getState().gestureHintSeen).toBe(true);

    view.unmount();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    expect(screen.queryByTestId("gesture-hint")).not.toBeInTheDocument();
  });

  it("show Previous, Flip and Next along the bottom in Buttons mode", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    const dialog = await openOptions(user);
    const modes = within(within(dialog).getByRole("group", { name: "Touch controls" }));
    await user.click(modes.getByRole("button", { name: "Buttons" }));
    expect(modes.getByRole("button", { name: "Buttons" })).toHaveAttribute("aria-pressed", "true");
    await closeOptions();

    const bar = within(screen.getByTestId("control-bar"));
    await user.click(bar.getByRole("button", { name: "Flip" }));
    expect(isFlipped()).toBe(true);
    await user.click(bar.getByRole("button", { name: /next/i }));
    expect(counter()).toBe("2 / 4");
    await user.click(bar.getByRole("button", { name: /previous/i }));
    expect(counter()).toBe("1 / 4");
  });

  it("remember the control-mode choice in this browser", async () => {
    const user = userEvent.setup();
    const view = render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await openOptions(user);
    await user.click(screen.getByRole("button", { name: "Buttons" }));
    await closeOptions();

    expect(useFlashcardPrefsStore.getState().controlMode).toBe("buttons");
    expect(localStorage.getItem("flashcard-prefs-v1")).toContain('"controlMode":"buttons"');

    view.unmount();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    expect(screen.getByTestId("control-bar")).toBeInTheDocument();

    // And back again.
    await openOptions(user);
    await user.click(screen.getByRole("button", { name: "Gestures" }));
    await closeOptions();
    expect(screen.queryByTestId("control-bar")).not.toBeInTheDocument();
  });
});

describe("tablet and desktop layouts", () => {
  it("show the physical controls and offer no gesture-mode switch", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    const bar = within(screen.getByTestId("control-bar"));
    expect(bar.getByRole("button", { name: /previous/i })).toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Flip" })).toBeInTheDocument();
    expect(bar.getByRole("button", { name: /next/i })).toBeInTheDocument();
    expect(screen.queryByTestId("gesture-hint")).not.toBeInTheDocument();

    const dialog = await openOptions(user);
    expect(within(dialog).queryByRole("group", { name: "Touch controls" })).toBeNull();
  });

  it("still accept gestures on the card", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    drag(card(), { dx: -150 });
    await settle();

    expect(counter()).toBe("2 / 4");
  });

  it("show keyboard hints to mouse and trackpad users", async () => {
    setMedia({ fine: true });
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.getByText("move")).toBeInTheDocument();
    expect(screen.getByText("flip")).toBeInTheDocument();

    const dialog = await openOptions(user);
    expect(within(dialog).getByRole("heading", { name: "Keyboard" })).toBeInTheDocument();
  });
});

describe("keyboard", () => {
  it("← and → move, Space flips, ↑ and ↓ flip, K marks known", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("2 / 4");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("1 / 4");
    await settle();

    fireEvent.keyDown(window, { key: " " });
    expect(isFlipped()).toBe(true);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(isFlipped()).toBe(false);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(isFlipped()).toBe(true);

    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByText("1 known")).toBeInTheDocument();
  });

  it("leaves Space and Enter to a focused button", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const next = screen.getByRole("button", { name: /next/i });

    next.focus();
    fireEvent.keyDown(next, { key: " " });
    fireEvent.keyDown(next, { key: "Enter" });

    // The button would handle these itself; the shortcut must not flip too.
    expect(isFlipped()).toBe(false);
  });

  it("ignores keys held with a modifier, so Alt+← still means Back", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(window, { key: " ", metaKey: true });

    expect(counter()).toBe("1 / 4");
    expect(isFlipped()).toBe(false);
  });

  it("leaves form controls and open dialogs alone", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await openOptions(user);
    const select = screen.getByLabelText("Filter by chapter");
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: " " });
    expect(counter()).toBe("1 / 4");
    expect(isFlipped()).toBe(false);

    await closeOptions();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("2 / 4");
  });
});

describe("reduced motion", () => {
  beforeEach(() => setMedia({ reduced: true }));

  it("replaces the 3D flip with a fade and keeps every action working", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.getByTestId("card-flipper")).toHaveAttribute("data-motion", "reduced");

    await user.click(card());
    expect(isFlipped()).toBe(true);

    drag(card(), { dx: -150 });
    await settle();
    expect(counter()).toBe("2 / 4");

    await user.click(screen.getByRole("button", { name: "Flip" }));
    expect(isFlipped()).toBe(true);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("1 / 4");
  });
});

describe("assistive technology", () => {
  it("announces moves and flips politely", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]')!;

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(live).toHaveTextContent("Card 2 of 4");

    fireEvent.keyDown(window, { key: " " });
    expect(live).toHaveTextContent("Showing answer");
  });

  it("exposes only the face that is showing", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.getAllByRole("button", { name: "Mark known" })).toHaveLength(1);
    expect(screen.getByText("Back 1").closest("[aria-hidden]")).toHaveAttribute(
      "aria-hidden",
      "true"
    );

    fireEvent.keyDown(window, { key: " " });
    expect(screen.getAllByRole("button", { name: "Mark known" })).toHaveLength(1);
    expect(screen.getByText("Front 1").closest("[aria-hidden]")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });

  it("reports progress as a labelled progress bar", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const progress = screen.getByRole("progressbar", { name: "Position in deck" });

    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuemax", "4");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(progress).toHaveAttribute("aria-valuetext", "Card 2 of 4");
  });
});
