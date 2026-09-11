/**
 * Immersive ("Full screen") study, the phone study screen's chrome, the
 * card's position inside the card, and orientation changes.
 *
 * jsdom performs no layout, so whether the card actually fills a 390×844 or
 * 844×390 screen is checked in real browsers (README → Real-browser checks).
 * These tests pin the structure that layout depends on, and every behaviour
 * that is not pixels: what is shown, what is reachable, what survives a
 * rotation, and when the browser's Fullscreen API is (and is not) called.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { DEFAULT_FONT_SIZE, useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import {
  COMPACT_QUERY,
  FINE_POINTER_QUERY,
  PHONE_LANDSCAPE_QUERY,
  REDUCED_MOTION_QUERY,
} from "@/lib/use-media-query";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const deck: FlashcardDeck = {
  slug: "upload-immersive",
  title: "Immersive Deck",
  cardCount: 5,
  chapters: [
    { id: "A", name: "A", cardCount: 4 },
    { id: "B", name: "B", cardCount: 1 },
  ],
  cards: [1, 2, 3, 4, 5].map((n) => ({
    id: n,
    chapter: n === 5 ? "B" : "A",
    tags: [],
    front: `<p>Front ${n}</p>`,
    back: `<p>Back ${n}</p>`,
  })),
};

// A matchMedia whose answers can change mid-test, the way a phone's do when
// it rotates.
const media = { compact: false, landscape: false, reduced: false, fine: false };
const mediaListeners = new Set<() => void>();
const originalMatchMedia = window.matchMedia;

function installMedia() {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return (
        (query === COMPACT_QUERY && media.compact) ||
        (query === PHONE_LANDSCAPE_QUERY && media.landscape) ||
        (query === REDUCED_MOTION_QUERY && media.reduced) ||
        (query === FINE_POINTER_QUERY && media.fine)
      );
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function setMedia(next: Partial<typeof media>) {
  Object.assign(media, next);
  act(() => mediaListeners.forEach((listener) => listener()));
}

/** Stands in for a browser that does, or does not, offer the Fullscreen API. */
function fakeFullscreenApi(available: boolean) {
  let element: Element | null = null;
  const change = () => document.dispatchEvent(new Event("fullscreenchange"));
  const request = vi.fn(async () => {
    element = document.documentElement;
    change();
  });
  const exit = vi.fn(async () => {
    element = null;
    change();
  });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => available });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: available ? request : undefined,
  });
  /** The browser leaving full screen on its own (Escape, system back…). */
  const browserExits = () =>
    act(() => {
      element = null;
      change();
    });
  return { request, exit, browserExits };
}

/** An iOS browser tab exposes navigator.standalone (false), a Home Screen app true. */
function fakeStandaloneProperty(value: boolean) {
  Object.defineProperty(navigator, "standalone", { configurable: true, value });
}

function removeFakes() {
  const doc = document as unknown as Record<string, unknown>;
  for (const name of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) delete doc[name];
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
  delete (navigator as unknown as Record<string, unknown>).standalone;
}

function counter() {
  const position = screen.getByTestId("card-position");
  return `${within(position).getByTestId("card-position-current").textContent} / ${within(position).getByTestId("card-position-total").textContent}`;
}

const card = () => screen.getAllByTestId("card-surface").at(-1)!;
const isFlipped = () =>
  screen.getAllByTestId("card-flipper").at(-1)!.getAttribute("data-flipped") === "true";

async function settle() {
  await waitFor(() => expect(screen.getAllByTestId("card-surface")).toHaveLength(1));
}

async function openOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Study options" }));
  return screen.findByRole("dialog", { name: "Study options" });
}

beforeEach(() => {
  localStorage.clear();
  useFlashcardsStore.setState({ knownByDeck: {} });
  useFlashcardPrefsStore.setState({
    font: "sans",
    fontSize: DEFAULT_FONT_SIZE,
    controlMode: "gestures",
    gestureHintSeen: true,
    cardLinks: "disabled",
    homeScreenTipSeen: false,
  });
  Object.assign(media, { compact: false, landscape: false, reduced: false, fine: false });
  mediaListeners.clear();
  installMedia();
});

afterEach(() => {
  cleanup();
  removeFakes();
  window.matchMedia = originalMatchMedia;
});

describe("the card's position, inside the card", () => {
  it("sits inside the card: the current card on the left, the total on the right", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const position = screen.getByTestId("card-position");
    const current = within(position).getByTestId("card-position-current");
    const total = within(position).getByTestId("card-position-total");

    expect(screen.getByTestId("card-flipper")).toContainElement(position);
    expect(current).toHaveTextContent(/^1$/);
    expect(total).toHaveTextContent(/^5$/);
    expect(current).toHaveClass("text-left");
    expect(total).toHaveClass("text-right");
    expect(current.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows just the two numbers, and reads as 'Card X of Y'", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const position = screen.getByTestId("card-position");

    expect(within(position).getByTestId("card-position-current")).toHaveAttribute("aria-hidden", "true");
    expect(within(position).getByTestId("card-position-total")).toHaveAttribute("aria-hidden", "true");
    expect(within(position).getByText("Card 1 of 5")).toHaveClass("sr-only");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(screen.getByTestId("card-position")).getByText("Card 2 of 5")).toBeInTheDocument();
  });

  it("counts the active study set, not the whole deck", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await openOptions(user);
    await user.selectOptions(screen.getByLabelText("Filter by chapter"), "A");
    expect(counter()).toBe("1 / 4");
    await user.selectOptions(screen.getByLabelText("Filter by chapter"), "B");
    expect(counter()).toBe("1 / 1");
  });

  it("has no card-count row or progress bar outside the card", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.queryByTestId("card-counter")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("the phone study screen", () => {
  beforeEach(() => setMedia({ compact: true }));

  it("shows no header, no visible deck title and no permanent back button", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByTitle("Immersive Deck")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to your decks" })).toBeNull();
    // Still the page's heading for anyone navigating by headings.
    expect(screen.getByRole("heading", { level: 1, name: "Immersive Deck" })).toHaveClass("sr-only");
  });

  it("floats Full screen and Study options over the card, as 44px targets", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const floating = within(screen.getByTestId("floating-controls"));

    for (const name of ["Full screen", "Study options"]) {
      const button = floating.getByRole("button", { name });
      expect(button).toHaveClass("h-11", "w-11");
    }
  });

  it("keeps the library one step away, in Study options", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={onExit} />);

    const dialog = await openOptions(user);
    await user.click(within(dialog).getByRole("button", { name: /exit study session/i }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("immersive mode", () => {
  it("hides the app's chrome and keeps the card, its controls and a way back", async () => {
    setMedia({ fine: true });
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("move")).toBeInTheDocument();

    // From the keyboard, so focus is expected to follow (see input-modality.ts).
    screen.getByRole("button", { name: "Full screen" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByTitle("Immersive Deck")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to your decks" })).toBeNull();
    expect(screen.queryByRole("button", { name: /switch to (dark|light) theme/i })).toBeNull();
    expect(screen.queryByText("move")).toBeNull();
    expect(screen.getByTestId("card-surface")).toBeInTheDocument();
    expect(screen.getByTestId("control-bar")).toBeInTheDocument();
    // One secondary control remains, and keyboard focus is on it.
    const options = within(screen.getByTestId("floating-controls")).getByRole("button", { name: "Study options" });
    expect(options).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
  });

  it("keeps the active card and the side that was showing", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    fireEvent.keyDown(window, { key: " " });
    const before = card();

    await user.click(screen.getByRole("button", { name: "Full screen" }));

    expect(counter()).toBe("3 / 5");
    expect(isFlipped()).toBe(true);
    expect(card()).toBe(before);
  });

  it("is left from Study options, restoring the normal controls", async () => {
    setMedia({ fine: true });
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));

    const dialog = await openOptions(user);
    within(dialog).getByRole("button", { name: "Exit full screen" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByTitle("Immersive Deck")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to your decks" })).toBeInTheDocument();
    expect(screen.getByText("move")).toBeInTheDocument();
    expect(screen.getByText("0 known")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Full screen" })).toHaveFocus());
  });

  it("after a tap, releases focus instead of lighting a ring on another control", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(document.activeElement).toBe(document.body);

    const dialog = await openOptions(user);
    await user.click(within(dialog).getByRole("button", { name: "Exit full screen" }));
    // Not left inside the closing sheet, where keys would be ignored.
    expect(document.activeElement?.closest("[role='dialog']")).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("2 / 5");
  });

  it("is left with Escape", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("on a phone, hides the Full screen control too, leaving only Study options", async () => {
    setMedia({ compact: true });
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Full screen" }));

    const floating = within(screen.getByTestId("floating-controls"));
    expect(floating.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Study options"]);
    expect(screen.queryByRole("button", { name: "Back to your decks" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("sr-only");
  });

  it("also asks the browser for full screen where the API genuinely exists", async () => {
    const fullscreen = fakeFullscreenApi(true);
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(fullscreen.request).toHaveBeenCalledTimes(1);

    // Leaving the browser's full screen by its own means leaves immersive too.
    fullscreen.browserExits();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("gives the screen back when leaving, and when the deck closes", async () => {
    const fullscreen = fakeFullscreenApi(true);
    const user = userEvent.setup();
    const view = render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(fullscreen.exit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    view.unmount();
    expect(fullscreen.exit).toHaveBeenCalledTimes(2);
  });

  it("does not call a Fullscreen API that is not there, and shows no error", async () => {
    const fullscreen = fakeFullscreenApi(false);
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Full screen" }));

    expect(fullscreen.request).not.toHaveBeenCalled();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("full screen on an iPhone browser tab", () => {
  beforeEach(() => {
    setMedia({ compact: true });
    fakeFullscreenApi(false);
    fakeStandaloneProperty(false);
  });

  it("enters immersive mode at once and offers the Home Screen — once", async () => {
    const user = userEvent.setup();
    const view = render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Full screen" }));

    const tip = screen.getByTestId("home-screen-tip");
    expect(tip).toHaveTextContent(
      "For the most screen space on iPhone, add Flashcards for All to your Home Screen."
    );
    expect(useFlashcardPrefsStore.getState().homeScreenTipSeen).toBe(true);

    await user.click(within(tip).getByRole("button", { name: "Dismiss tip" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.queryByTestId("home-screen-tip")).toBeNull();

    view.unmount();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.queryByTestId("home-screen-tip")).toBeNull();
  });

  it("explains Add to Home Screen — and that decks do not move over by themselves", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));

    await user.click(within(screen.getByTestId("home-screen-tip")).getByRole("button", { name: "How" }));
    const help = await screen.findByRole("dialog", { name: /Add Flashcards for All to your Home Screen/ });

    // Not Safari-only: other iOS browsers reach Add to Home Screen through the same Share menu.
    expect(help).toHaveTextContent(/Share/);
    expect(help).toHaveTextContent(/Chrome and other browsers/);
    expect(help).toHaveTextContent(/Add to Home Screen/);
    // Storage is not shared, and the sheet must not claim otherwise.
    expect(help).toHaveTextContent(/stored only on this device/);
    expect(help).toHaveTextContent(/separate storage/);
    expect(help).toHaveTextContent(/import your .apkg deck again/);
    expect(help.textContent).not.toMatch(/automatically (move|transfer|sync)/i);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Focus is not left behind in the closed sheet: Escape now leaves immersive mode.
    expect(screen.getByRole("button", { name: "Study options" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Full screen" })).toBeInTheDocument();
  });

  it("keeps the help one tap away in Study options", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    const dialog = await openOptions(user);
    await user.click(within(dialog).getByRole("button", { name: /Add to Home Screen/ }));

    expect(await screen.findByRole("dialog", { name: /Home Screen/ })).toBeInTheDocument();
  });
});

describe("running from the Home Screen", () => {
  it("is detected for messaging only: no Home Screen offer, a note about separate storage", async () => {
    setMedia({ compact: true });
    fakeFullscreenApi(false);
    fakeStandaloneProperty(true);
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.queryByTestId("home-screen-tip")).toBeNull();

    const dialog = await openOptions(user);
    expect(within(dialog).queryByRole("button", { name: /Add to Home Screen/ })).toBeNull();
    expect(dialog).toHaveTextContent(/Opened from your Home Screen/);
    // The study itself is the same: every control is still there.
    expect(within(dialog).getByRole("group", { name: "Card links" })).toBeInTheDocument();
  });
});

describe("rotating the phone", () => {
  beforeEach(() => setMedia({ compact: true }));

  it("keeps the same card, the same side and the same card element", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    fireEvent.keyDown(window, { key: " " });
    const before = card();

    setMedia({ landscape: true });
    expect(card()).toBe(before);
    expect(counter()).toBe("3 / 5");
    expect(isFlipped()).toBe(true);

    setMedia({ landscape: false });
    expect(card()).toBe(before);
    expect(counter()).toBe("3 / 5");
    expect(isFlipped()).toBe(true);
  });

  it("moves Buttons-mode controls from a bottom strip to side rails, and they still work", async () => {
    useFlashcardPrefsStore.setState({ controlMode: "buttons" });
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    expect(screen.getByTestId("control-bar")).toHaveAttribute("data-variant", "strip");

    setMedia({ landscape: true });
    const rails = screen.getByTestId("control-bar");
    expect(rails).toHaveAttribute("data-variant", "rails");
    await user.click(within(rails).getByRole("button", { name: /next/i }));
    expect(counter()).toBe("2 / 5");
    await user.click(within(rails).getByRole("button", { name: "Flip" }));
    expect(isFlipped()).toBe(true);
    await user.click(within(rails).getByRole("button", { name: /previous/i }));
    expect(counter()).toBe("1 / 5");
  });

  it("stays immersive through a rotation", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));

    setMedia({ landscape: true });

    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Study options" })).toBeInTheDocument();
  });
});

describe("reduced motion", () => {
  it("flips and moves without the turn or the slide", async () => {
    setMedia({ reduced: true, compact: true });
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(card());
    expect(isFlipped()).toBe(true);
    await waitFor(() => expect(screen.getByTestId("card-flipper")).toHaveAttribute("data-painted", "back"));
    expect(screen.getByTestId("card-flipper").style.transform).toBe("perspective(1100px) rotateY(0deg)");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    expect(counter()).toBe("2 / 5");
  });
});
