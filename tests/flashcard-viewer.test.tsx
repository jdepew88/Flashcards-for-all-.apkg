/**
 * The study interface: rendering, reveal/flip, navigation, shuffle, restart,
 * filtering, known-marking and leaving the deck.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import { DEFAULT_FONT_SIZE } from "@/lib/stores/prefs-store";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const deck: FlashcardDeck = {
  slug: "upload-test-deck",
  title: "Test Deck",
  cardCount: 4,
  chapters: [
    { id: "Chapter A", name: "Chapter A", cardCount: 3 },
    { id: "Chapter B", name: "Chapter B", cardCount: 1 },
  ],
  cards: [
    { id: 1, chapter: "Chapter A", tags: ["a"], front: "<p>Front one</p>", back: "<p>Back one</p>" },
    { id: 2, chapter: "Chapter A", tags: ["a"], front: "<p>Front two</p>", back: "<p>Back two</p>" },
    { id: 3, chapter: "Chapter A", tags: [], front: "<p>Front three</p>", back: "<p>Back three</p>" },
    { id: 4, chapter: "Chapter B", tags: [], front: "<p>Front four</p>", back: "<p>Back four</p>" },
  ],
};

function counter() {
  return screen.getByTestId("card-counter").textContent?.replace(/\s+/g, " ").trim();
}

function isFlipped() {
  const flippers = screen.getAllByTestId("card-flipper");
  return flippers[flippers.length - 1].getAttribute("data-flipped") === "true";
}

/** Waits until the outgoing card has been removed and one card is on screen. */
async function settle() {
  await waitFor(() => expect(screen.getAllByTestId("card-flipper")).toHaveLength(1));
}

beforeEach(() => {
  localStorage.clear();
  useFlashcardsStore.setState({ knownByDeck: {} });
  useFlashcardPrefsStore.setState({ font: "sans", fontSize: DEFAULT_FONT_SIZE });
});

afterEach(cleanup);

describe("rendering", () => {
  it("shows the deck title, the first card and the total count", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.getByTitle("Test Deck")).toBeInTheDocument();
    expect(screen.getByText("Front one")).toBeInTheDocument();
    expect(counter()).toBe("1 / 4");
  });

  it("renders card HTML rather than escaping it", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    const [face] = document.querySelectorAll(".anki-card-content");
    expect(face.innerHTML).toBe("<p>Front one</p>");
  });

  it("renders both faces so the flip animation has something to turn to", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.getByText("Front one")).toBeInTheDocument();
    expect(screen.getByText("Back one")).toBeInTheDocument();
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.getByText("Answer")).toBeInTheDocument();
  });
});

describe("reveal / flip", () => {
  it("flips with the Reveal button and back again", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(isFlipped()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(isFlipped()).toBe(true);

    await user.click(screen.getByRole("button", { name: "Question" }));
    expect(isFlipped()).toBe(false);
  });

  it("flips with the spacebar", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: " " });
    expect(isFlipped()).toBe(true);

    fireEvent.keyDown(window, { key: " " });
    expect(isFlipped()).toBe(false);
  });

  it("resets to the question side when moving to another card", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(isFlipped()).toBe(true);

    await user.click(screen.getByRole("button", { name: /next/i }));
    await settle();
    expect(isFlipped()).toBe(false);
  });
});

describe("navigation", () => {
  it("moves forward and back with the buttons", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(counter()).toBe("2 / 4");
    expect(screen.getByText("Front two")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /previous/i }));
    expect(counter()).toBe("1 / 4");
    expect(screen.getByText("Front one")).toBeInTheDocument();
  });

  it("moves with the arrow keys", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("2 / 4");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("1 / 4");
  });

  it("disables Previous on the first card and Next on the last", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();

    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: /next/i }));
    }
    expect(counter()).toBe("4 / 4");
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("does not run past either end with the keyboard", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("1 / 4");

    for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("4 / 4");
  });

  it("leaves the chapter select's own keyboard behavior alone", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const select = screen.getByLabelText("Filter by chapter");

    select.focus();
    fireEvent.keyDown(select, { key: "ArrowRight", bubbles: true });

    expect(counter()).toBe("1 / 4");
  });
});

describe("shuffle and restart", () => {
  it("toggles shuffle and keeps every card in the run", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const shuffleButton = screen.getByRole("button", { name: "Shuffle order" });

    expect(shuffleButton).toHaveAttribute("aria-pressed", "false");

    await user.click(shuffleButton);
    expect(shuffleButton).toHaveAttribute("aria-pressed", "true");
    expect(counter()).toBe("1 / 4");

    await user.click(shuffleButton);
    expect(shuffleButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Front one")).toBeInTheDocument();
  });

  it("actually reorders the cards", async () => {
    // Deterministic "shuffle": reverse the array by always picking index 0.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Shuffle order" }));
    await settle();

    expect(screen.queryByText("Front one")).not.toBeInTheDocument();
    expect(counter()).toBe("1 / 4");
    random.mockRestore();
  });

  it("restarts back to the first card", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(counter()).toBe("3 / 4");

    await user.click(screen.getByRole("button", { name: "Restart deck" }));
    await settle();
    expect(counter()).toBe("1 / 4");
    expect(screen.getByText("Front one")).toBeInTheDocument();
    expect(isFlipped()).toBe(false);
  });
});

describe("chapter filtering", () => {
  it("narrows the run to one chapter and back", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const select = screen.getByLabelText("Filter by chapter");

    await user.selectOptions(select, "Chapter B");
    expect(counter()).toBe("1 / 1");
    expect(screen.getByText("Front four")).toBeInTheDocument();

    await user.selectOptions(select, "all");
    expect(counter()).toBe("1 / 4");
  });

  it("lists each chapter with its own card count", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const select = screen.getByLabelText("Filter by chapter");

    expect(within(select).getByText("All chapters (4)")).toBeInTheDocument();
    expect(within(select).getByText("Chapter A (3)")).toBeInTheDocument();
    expect(within(select).getByText("Chapter B (1)")).toBeInTheDocument();
  });
});

describe("known tracking", () => {
  it("marks a card known and counts it", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.getByText("0 known")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Mark as known" })[0]);

    expect(screen.getByText("1 known")).toBeInTheDocument();
    expect(useFlashcardsStore.getState().knownByDeck["upload-test-deck"]).toEqual([1]);
  });

  it("hides known cards on request, and offers a way out of an empty filter", async () => {
    const user = userEvent.setup();
    useFlashcardsStore.setState({ knownByDeck: { "upload-test-deck": [1, 2, 3, 4] } });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Hide known" }));

    expect(counter()).toBe("0 / 0");
    expect(screen.getByText("No cards match this filter.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(counter()).toBe("1 / 4");
  });

  it("clears this deck's progress from the options sheet", async () => {
    const user = userEvent.setup();
    useFlashcardsStore.setState({ knownByDeck: { "upload-test-deck": [1, 2] } });
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    expect(screen.getByText("2 known")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowUp" });
    await user.click(await screen.findByRole("button", { name: /reset progress/i }));

    expect(screen.getByText("0 known")).toBeInTheDocument();
    expect(useFlashcardsStore.getState().knownByDeck["upload-test-deck"]).toBeUndefined();
  });
});

describe("reading options", () => {
  it("opens with ArrowUp, changes text size, and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(await screen.findByRole("dialog", { name: /reading options/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Increase text size" }));
    expect(useFlashcardPrefsStore.getState().fontSize).toBe(DEFAULT_FONT_SIZE + 1);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /reading options/i })).not.toBeInTheDocument()
    );
  });

  it("does not navigate cards while the sheet is open", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowUp" });
    await screen.findByRole("dialog", { name: /reading options/i });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("1 / 4");
  });
});

describe("leaving the deck", () => {
  it("exits from the header button", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={onExit} />);

    await user.click(screen.getByRole("button", { name: "Load another deck" }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("exits from the options sheet", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={onExit} />);

    fireEvent.keyDown(window, { key: "ArrowUp" });
    await user.click(await screen.findByRole("button", { name: /exit study session/i }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
