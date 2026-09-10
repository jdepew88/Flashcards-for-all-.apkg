/**
 * The whole chain, in one place:
 *
 *   uploaded file -> parseApkgFile -> FlashcardDeck -> viewer state -> UI
 *
 * This is the test that says "a deck that works in CCNA Practice Labs works
 * here unchanged": it takes the real .apkg off disk, runs the extracted parser
 * over it, and drives the viewer with the result — no hand-built deck object
 * standing in for the parser's output anywhere.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import { StudyScreen } from "@/components/study-screen";
import { resolveDeckMedia } from "@/lib/flashcards/resolve-deck-media";
import { parseApkgFile } from "@/lib/flashcards/client-import";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const WASM_PATH = resolve(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm");
const SAMPLE_PATH = resolve(process.cwd(), "public/sample-deck.apkg");

let parsedDeck: FlashcardDeck;
let parsedMedia: Map<string, Blob>;

beforeAll(async () => {
  const bytes = await readFile(SAMPLE_PATH);
  const file = new File([new Uint8Array(bytes)], "sample-deck.apkg");
  const result = await parseApkgFile(file, undefined, { wasmUrl: WASM_PATH });
  parsedDeck = result.deck;
  parsedMedia = result.media;
});

beforeEach(() => {
  localStorage.clear();
  useFlashcardsStore.setState({ knownByDeck: {} });
});

afterEach(cleanup);

async function chooseChapter(user: ReturnType<typeof userEvent.setup>, chapter: string) {
  await user.click(screen.getByRole("button", { name: "Study options" }));
  await user.selectOptions(await screen.findByLabelText("Filter by chapter"), chapter);
}

describe("a parsed .apkg drives the study interface", () => {
  it("renders the parsed deck and steps through every card", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={parsedDeck} onExit={vi.fn()} />);

    expect(screen.getByTestId("card-counter")).toHaveTextContent("1 / 6");

    for (let i = 2; i <= 6; i++) {
      await user.click(screen.getByRole("button", { name: /next/i }));
      await waitFor(() => expect(screen.getAllByTestId("card-flipper")).toHaveLength(1));
      expect(screen.getByTestId("card-counter")).toHaveTextContent(`${i} / 6`);
    }

    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("offers the deck's Anki subdecks as chapter filters", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={parsedDeck} onExit={vi.fn()} />);

    await chooseChapter(user, "Chapter 2 - Cloze Practice");

    expect(screen.getByTestId("card-counter")).toHaveTextContent("1 / 1");
    expect(document.body.innerHTML).toContain("cloze-blank");
  });

  it("shows rendered Anki HTML on the card, not escaped markup", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={parsedDeck} onExit={vi.fn()} />);

    await chooseChapter(user, "Chapter 1 - Networking Basics");

    // The OSI note's front is "What does <b>OSI</b> stand for?" — the <b> must
    // reach the DOM as an element.
    await waitFor(() => expect(document.querySelector(".anki-card-content b")).not.toBeNull());
  });

  it("points card media at blob URLs created from the deck's own files", () => {
    const mediaUrls = new Map([["diagram.png", "blob:test-diagram"]]);
    const resolved = resolveDeckMedia(parsedDeck, mediaUrls);
    const withImage = resolved.cards.find((c) => c.chapter === "Chapter 3 - Diagrams");

    expect(parsedMedia.has("diagram.png")).toBe(true);
    expect(withImage!.front).toContain('src="blob:test-diagram"');
    expect(withImage!.front).not.toContain('src="diagram.png"');
  });
});

describe("loading a deck, then another one", () => {
  it("loads a stored deck, exits, and loads a different one", async () => {
    const decks = new Map<string, { deck: FlashcardDeck; media: Map<string, Blob> }>([
      ["upload-a", { deck: { ...parsedDeck, slug: "upload-a", title: "Deck A" }, media: new Map() }],
      [
        "upload-b",
        {
          deck: {
            ...parsedDeck,
            slug: "upload-b",
            title: "Deck B",
            cardCount: 1,
            chapters: [{ id: "Only", name: "Only", cardCount: 1 }],
            cards: [{ id: 99, chapter: "Only", tags: [], front: "<p>B front</p>", back: "<p>B back</p>" }],
          },
          media: new Map(),
        },
      ],
    ]);

    vi.doMock("@/lib/flashcards/uploaded-decks", () => ({
      loadUploadedDeck: async (slug: string) => decks.get(slug),
    }));
    vi.resetModules();
    const { StudyScreen: Screen } = await import("@/components/study-screen");

    const onExit = vi.fn();
    const user = userEvent.setup();
    const view = render(<Screen slug="upload-a" onExit={onExit} />);

    expect(await screen.findByTitle("Deck A")).toBeInTheDocument();
    expect(screen.getByTestId("card-counter")).toHaveTextContent("1 / 6");

    await user.click(screen.getByRole("button", { name: "Back to your decks" }));
    expect(onExit).toHaveBeenCalledTimes(1);

    view.rerender(<Screen slug="upload-b" onExit={onExit} />);

    expect(await screen.findByTitle("Deck B")).toBeInTheDocument();
    expect(screen.getByTestId("card-counter")).toHaveTextContent("1 / 1");
    expect(screen.getByText("B front")).toBeInTheDocument();

    vi.doUnmock("@/lib/flashcards/uploaded-decks");
    vi.resetModules();
  });

  it("explains itself when a deck slug is not on this device", async () => {
    vi.doMock("@/lib/flashcards/uploaded-decks", () => ({
      loadUploadedDeck: async () => undefined,
    }));
    vi.resetModules();
    const { StudyScreen: Screen } = await import("@/components/study-screen");

    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<Screen slug="upload-missing" onExit={onExit} />);

    expect(await screen.findByText(/couldn't find that deck/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to your decks/i }));
    expect(onExit).toHaveBeenCalledTimes(1);

    vi.doUnmock("@/lib/flashcards/uploaded-decks");
    vi.resetModules();
  });

  it("treats an empty slug as not found rather than hanging on the loader", async () => {
    render(<StudyScreen slug="" onExit={vi.fn()} />);

    expect(await screen.findByText(/couldn't find that deck/i)).toBeInTheDocument();
  });
});
