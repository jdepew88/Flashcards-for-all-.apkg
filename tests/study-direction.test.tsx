/**
 * Study direction: which side a card opens on when it becomes the current
 * card — the word (front) or the definition (back).
 *
 * It is one preference in the reading-preferences store, so it is kept on this
 * device only. It never changes a card: Flip turns any card either way, and
 * the card already up stays as it is when the direction changes. Every way of
 * reaching a card — Next, Previous, keys, swipes, and the phone's card-under-
 * card deck — opens it on the chosen side.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { DEFAULT_FONT_SIZE, useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import { COMPACT_QUERY } from "@/lib/use-media-query";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const deck: FlashcardDeck = {
  slug: "upload-direction",
  title: "Direction Deck",
  cardCount: 4,
  chapters: [{ id: "Only", name: "Only", cardCount: 4 }],
  cards: [1, 2, 3, 4].map((n) => ({
    id: n,
    chapter: "Only",
    tags: [],
    front: `<p>Word ${n}</p>`,
    back: `<p>Definition ${n}</p>`,
  })),
};

const originalMatchMedia = window.matchMedia;

function setMedia({ compact = false } = {}) {
  window.matchMedia = ((query: string) => ({
    matches: query === COMPACT_QUERY && compact,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const position = () => within(screen.getByTestId("card-position")).getByText(/^Card \d/).textContent;
const flipper = () => screen.getAllByTestId("card-flipper").at(-1)!;
/** The side that is up on the current card, and that it is the side painted. */
function sideUp() {
  const side = flipper().getAttribute("data-flipped") === "true" ? "back" : "front";
  expect(flipper()).toHaveAttribute("data-painted", side);
  return side;
}
const direction = () => useFlashcardPrefsStore.getState().studyDirection;

async function settle() {
  await waitFor(() => expect(screen.getAllByTestId("card-surface")).toHaveLength(1));
}

async function next() {
  fireEvent.keyDown(window, { key: "ArrowRight" });
  await settle();
}

async function previous() {
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  await settle();
}

const flip = () => fireEvent.keyDown(window, { key: " " });

/** Picks a study direction in Study options, then closes the sheet. */
async function chooseInOptions(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getAllByRole("button", { name: "Study options" })[0]);
  const group = within(await screen.findByRole("group", { name: "Study direction" }));
  await user.click(group.getByRole("button", { name: label }));
  await user.click(screen.getByRole("button", { name: "Close options" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

beforeEach(() => {
  localStorage.clear();
  useFlashcardsStore.setState({ knownByDeck: {} });
  useFlashcardPrefsStore.setState({
    font: "serif",
    fontSize: DEFAULT_FONT_SIZE,
    controlMode: "gestures",
    gestureHintSeen: true,
    studyDirection: "front-first",
  });
  setMedia();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
});

describe("study direction", () => {
  it("defaults to Word → Definition: cards open on the word", async () => {
    useFlashcardPrefsStore.persist.clearStorage();
    await useFlashcardPrefsStore.persist.rehydrate();
    expect(useFlashcardPrefsStore.getInitialState().studyDirection).toBe("front-first");

    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    expect(sideUp()).toBe("front");
    expect(screen.getByText("Word 1")).toBeInTheDocument();
    await next();
    expect(sideUp()).toBe("front");
    expect(screen.getByTestId("pin-direction")).toHaveAttribute("aria-pressed", "false");
  });

  it("Definition → Word opens new cards on the definition", () => {
    useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    expect(sideUp()).toBe("back");
    const back = flipper().querySelector<HTMLElement>('[data-face="back"]')!;
    expect(within(back).getByText("Definition 1")).toBeInTheDocument();
    expect(back).not.toHaveAttribute("aria-hidden");
  });

  it("Flip still turns the current card over, both ways", async () => {
    useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const card = screen.getByTestId("card-surface");
    flip();
    await waitFor(() => expect(sideUp()).toBe("front"));
    flip();
    await waitFor(() => expect(sideUp()).toBe("back"));
    expect(screen.getByTestId("card-surface")).toBe(card);
    expect(position()).toBe("Card 1 of 4");
  });

  it("Next and Previous open each card on the definition, however the last one was left", async () => {
    useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    flip(); // the word up on card 1
    await next();
    expect(position()).toBe("Card 2 of 4");
    expect(sideUp()).toBe("back");

    flip(); // the word up on card 2
    await previous();
    expect(position()).toBe("Card 1 of 4");
    expect(sideUp()).toBe("back");
  });

  it("the buttons follow it too", async () => {
    const user = userEvent.setup();
    useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Next/ }));
    await settle();
    expect(sideUp()).toBe("back");
    await user.click(screen.getByRole("button", { name: /^Previous/ }));
    await settle();
    expect(sideUp()).toBe("back");
  });

  it("pinned Definition → Word stays in force across cards, and is remembered on this device", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const pin = screen.getByTestId("pin-direction");
    expect(pin).toHaveAccessibleName("Keep definitions first");

    await user.click(pin);
    expect(pin).toHaveAttribute("aria-pressed", "true");
    expect(direction()).toBe("back-first");
    expect(JSON.parse(localStorage.getItem("flashcard-prefs-v1")!).state.studyDirection).toBe("back-first");

    for (const n of [2, 3, 4]) {
      await next();
      expect(position()).toBe(`Card ${n} of 4`);
      expect(sideUp()).toBe("back");
    }
  });

  it("changing the direction leaves the card already up exactly as it is", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const card = screen.getByTestId("card-surface");

    await chooseInOptions(user, /^Definition to Word$/);
    expect(direction()).toBe("back-first");
    // No turn and no swap: the same card, still on its word.
    expect(screen.getByTestId("card-surface")).toBe(card);
    expect(sideUp()).toBe("front");
    expect(screen.getByText(/from the next card/)).toBeInTheDocument();

    await next();
    expect(sideUp()).toBe("back");
  });

  it("switching back to Word → Definition opens cards on the word again", async () => {
    const user = userEvent.setup();
    useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const group = () => within(screen.getByRole("dialog")).getByRole("group", { name: "Study direction" });

    await user.click(screen.getAllByRole("button", { name: "Study options" })[0]);
    await screen.findByRole("dialog");
    expect(within(group()).getByRole("button", { name: /^Definition to Word$/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group()).getByRole("button", { name: /^Word to Definition$/ }));
    expect(within(group()).getByRole("button", { name: /^Word to Definition$/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Close options" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(sideUp()).toBe("back"); // the current card is left alone
    await next();
    expect(sideUp()).toBe("front");
    await previous();
    expect(sideUp()).toBe("front");
  });

  it("restarting the deck opens the first card on the chosen side", async () => {
    useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await next();
    await next();
    fireEvent.click(screen.getAllByRole("button", { name: "Study options" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Restart deck" }));
    await settle();
    expect(position()).toBe("Card 1 of 4");
    expect(sideUp()).toBe("back");
  });

  it("reads the answer as the side the card did not open on", () => {
    useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    flip();
    expect(screen.getByText("Showing answer")).toBeInTheDocument();
    flip();
    expect(screen.getByText("Showing question")).toBeInTheDocument();
  });

  describe("on a phone's hand deck", () => {
    const finger = { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0 };
    const under = () => screen.queryByTestId("card-under");

    function drag(to: number) {
      const top = screen.getByTestId("card-surface");
      fireEvent.pointerDown(top, { ...finger, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: 200 + Math.sign(to - 200) * 15, clientY: 300 });
      fireEvent.pointerMove(top, { ...finger, clientX: to, clientY: 300 });
      return top;
    }

    it("a swipe to the next card uncovers it already on its definition, and keeps it there", async () => {
      setMedia({ compact: true });
      useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
      flip(); // the word up on the top card

      const top = drag(120);
      const beneath = under()!;
      expect(beneath).toHaveAttribute("data-deck", "under");
      expect(screen.getByTestId("card-under-flipper")).toHaveAttribute("data-flipped", "true");
      const back = beneath.querySelector<HTMLElement>('[data-face="back"]')!;
      expect(within(back).getByText("Definition 2")).toBeInTheDocument();

      fireEvent.pointerUp(top, { ...finger, clientX: 120, clientY: 300 });
      await settle();
      // The same card, promoted, still on its definition: nothing turned.
      expect(screen.getByTestId("card-surface")).toBe(beneath);
      expect(beneath).toHaveAttribute("data-deck", "top");
      expect(position()).toBe("Card 2 of 4");
      expect(sideUp()).toBe("back");
      expect(under()).toBeNull();
    });

    it("a swipe back to the previous card opens it on its definition", async () => {
      setMedia({ compact: true });
      useFlashcardPrefsStore.setState({ studyDirection: "back-first" });
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
      await next();
      flip();

      const top = drag(290);
      expect(screen.getByTestId("card-under-flipper")).toHaveAttribute("data-flipped", "true");
      fireEvent.pointerUp(top, { ...finger, clientX: 290, clientY: 300 });
      await settle();
      expect(position()).toBe("Card 1 of 4");
      expect(sideUp()).toBe("back");
    });

    it("leaves Word → Definition's deck as it was: the card beneath is word up", async () => {
      setMedia({ compact: true });
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
      const top = drag(120);
      expect(screen.getByTestId("card-under-flipper")).toHaveAttribute("data-flipped", "false");
      expect(within(under()!).getByText("Word 2")).toBeInTheDocument();
      fireEvent.pointerUp(top, { ...finger, clientX: 120, clientY: 300 });
      await settle();
      expect(position()).toBe("Card 2 of 4");
      expect(sideUp()).toBe("front");
    });

    it("keeps the pin off the phone's card: the choice is in Study options", () => {
      setMedia({ compact: true });
      render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
      expect(screen.queryByTestId("pin-direction")).toBeNull();
    });
  });
});
