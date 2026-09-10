/**
 * The landing page: importing a deck, the local deck library, confirmed
 * deletion, and what the page tells the visitor about where their data lives.
 *
 * Storage is NOT mocked here — these run against a real IndexedDB
 * (fake-indexeddb), so "the deck was saved" means it really was written and can
 * really be read back. Only the sql.js wasm path is redirected, because jsdom
 * has no server to fetch /sql-wasm.wasm from.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadScreen } from "@/components/upload-screen";
import {
  deleteAllUploadedDecks,
  listUploadedDecks,
  loadDeckSource,
  loadUploadedDeck,
  saveUploadedDeck,
} from "@/lib/flashcards/uploaded-decks";
import { deleteAllDeckProgress, useFlashcardsStore } from "@/lib/stores/known-store";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const WASM_PATH = resolve(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm");
const SAMPLE_PATH = resolve(process.cwd(), "public/sample-deck.apkg");

vi.mock("@/lib/flashcards/client-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flashcards/client-import")>();
  return {
    ...actual,
    parseApkgFile: (
      file: File,
      onProgress?: (message: string) => void,
      options?: { wasmUrl?: string }
    ) => actual.parseApkgFile(file, onProgress, { wasmUrl: options?.wasmUrl ?? WASM_PATH }),
  };
});

async function sampleFile(name = "sample-deck.apkg"): Promise<File> {
  const bytes = await readFile(SAMPLE_PATH);
  return new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });
}

function deckFixture(slug: string, title: string, cards = 3): FlashcardDeck {
  return {
    slug,
    title,
    cardCount: cards,
    chapters: [{ id: "Ch", name: "Ch", cardCount: cards }],
    cards: Array.from({ length: cards }, (_, i) => ({
      id: i + 1,
      chapter: "Ch",
      tags: [],
      front: `<p>F${i}</p>`,
      back: `<p>B${i}</p>`,
    })),
  };
}

const fileInput = () => document.querySelector<HTMLInputElement>("#apkg-upload")!;
const dropZone = () => document.querySelector('label[for="apkg-upload"]')!;

/** The deck library list, once it has rendered. */
async function library() {
  return within(await screen.findByRole("list", { name: "Saved decks" }));
}

beforeEach(async () => {
  await deleteAllUploadedDecks();
  deleteAllDeckProgress();
});

afterEach(async () => {
  cleanup();
  await deleteAllUploadedDecks();
});

describe("what the page says", () => {
  it("leads with the title, the promise and the primary action", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Flashcard Study Tool" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Import a flashcard deck and study it directly in your browser/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Drop a \.apkg file here, or tap to choose one/i)).toBeInTheDocument();
  });

  it("states the local-processing promise next to the import control", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(
      screen.getByText(/Processed and saved locally in your browser — never uploaded/i)
    ).toBeInTheDocument();
  });

  it("explains the privacy behavior the implementation actually has", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /Your flashcards stay on this device/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/opened and processed directly in your browser. It is not uploaded/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Imported decks are saved locally in this browser/i)
    ).toBeInTheDocument();
  });

  it("is honest about the limits of browser storage", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(screen.getByText(/Saved decks belong to this browser on this device/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /will not automatically appear on another computer, phone, browser, or browser profile/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Clearing this site's browser data will remove locally saved decks/i)
    ).toBeInTheDocument();
  });

  it("names the one accepted file type on the control itself", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(fileInput().accept).toBe(".apkg");
    expect(screen.getByRole("heading", { name: /supported file format/i })).toBeInTheDocument();
  });

  it("says the original file on disk is untouched", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(
      screen.getByText(/Importing a deck never changes the original file on your computer/i)
    ).toBeInTheDocument();
  });
});

describe("importing a deck", () => {
  it("parses locally, persists to IndexedDB, and starts studying", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    await user.upload(fileInput(), await sampleFile());

    await waitFor(() => expect(onStudy).toHaveBeenCalledTimes(1));

    const stored = await listUploadedDecks();
    expect(stored).toHaveLength(1);
    expect(stored[0].cardCount).toBe(6);
    expect(stored[0].fileName).toBe("sample-deck.apkg");
    expect(onStudy).toHaveBeenCalledWith(stored[0].slug);

    // Really readable back, not merely recorded.
    const reopened = await loadUploadedDeck(stored[0].slug);
    expect(reopened!.deck.cards).toHaveLength(6);
  });

  it("retains the original .apkg so it can be downloaded again", async () => {
    const user = userEvent.setup();
    const source = await sampleFile();
    render(<UploadScreen onStudy={vi.fn()} />);

    await user.upload(fileInput(), source);
    await waitFor(async () => expect(await listUploadedDecks()).toHaveLength(1));

    const [meta] = await listUploadedDecks();
    const blob = await loadDeckSource(meta.slug);
    expect(blob!.size).toBe(source.size);
  });

  it("accepts a file dropped onto the target", async () => {
    const onStudy = vi.fn();
    render(<UploadScreen onStudy={onStudy} />);
    const file = await sampleFile();

    fireEvent.dragOver(dropZone(), { dataTransfer: { files: [file] } });
    fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onStudy).toHaveBeenCalledTimes(1));
    expect(await listUploadedDecks()).toHaveLength(1);
  });

  it("shows a previously imported deck to a returning visitor", async () => {
    // Stands in for "came back tomorrow": the deck is already in IndexedDB and
    // the page has to find it without the file being selected again.
    await saveUploadedDeck({
      deck: deckFixture("upload-x", "Earlier Deck", 12),
      media: new Map(),
      source: await sampleFile("earlier.apkg"),
    });

    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    expect(await screen.findByText("Earlier Deck")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your decks" })).toBeInTheDocument();
    expect(screen.getByText(/12 cards · 1 chapters/)).toBeInTheDocument();

    await user.click((await library()).getByRole("button", { name: "Study" }));
    expect(onStudy).toHaveBeenCalledWith("upload-x");
  });

  it("offers a download for the original file only when one was retained", async () => {
    await saveUploadedDeck({
      deck: deckFixture("upload-with", "With Source"),
      media: new Map(),
      source: await sampleFile(),
    });
    await saveUploadedDeck({ deck: deckFixture("upload-without", "No Source"), media: new Map() });

    render(<UploadScreen onStudy={vi.fn()} />);
    await screen.findByText("With Source");

    expect(
      screen.getByRole("button", { name: /Download original \.apkg for With Source/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Download original \.apkg for No Source/i })
    ).toBeNull();
  });

  it("builds the download from local bytes without any request", async () => {
    const source = await sampleFile("original-name.apkg");
    await saveUploadedDeck({
      deck: deckFixture("upload-x", "Downloadable"),
      media: new Map(),
      source,
    });

    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const clicks: HTMLAnchorElement[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this);
      });

    const user = userEvent.setup();
    render(<UploadScreen onStudy={vi.fn()} />);
    await screen.findByText("Downloadable");
    await user.click(screen.getByRole("button", { name: /Download original \.apkg/i }));

    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0].download).toBe("original-name.apkg");
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeUrl).toHaveBeenCalledWith("blob:local");
    expect(fetchSpy).not.toHaveBeenCalled();

    clickSpy.mockRestore();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    fetchSpy.mockRestore();
  });
});

describe("deleting from the library", () => {
  it("asks for confirmation, naming what is and is not affected", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-x", "CCNA Fundamentals"), media: new Map() });
    const user = userEvent.setup();
    render(<UploadScreen onStudy={vi.fn()} />);
    await screen.findByText("CCNA Fundamentals");

    await user.click(screen.getByRole("button", { name: "Delete CCNA Fundamentals" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName('Delete "CCNA Fundamentals" from this browser?');
    expect(
      within(dialog).getByText(/removes the locally stored deck and its study progress/i)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/original \.apkg file on your computer will not be affected/i)
    ).toBeInTheDocument();

    // Still there — a confirmation prompt must not have deleted anything yet.
    expect(await listUploadedDecks()).toHaveLength(1);
  });

  it("cancelling leaves the deck alone", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-x", "Keep Me"), media: new Map() });
    const user = userEvent.setup();
    render(<UploadScreen onStudy={vi.fn()} />);
    await screen.findByText("Keep Me");

    await user.click(screen.getByRole("button", { name: "Delete Keep Me" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(await listUploadedDecks()).toHaveLength(1);
    expect(screen.getByText("Keep Me")).toBeInTheDocument();
  });

  it("confirming removes the deck, its stored data and its progress", async () => {
    await saveUploadedDeck({
      deck: deckFixture("upload-x", "Doomed"),
      media: new Map([["a.png", new Blob([new Uint8Array([1])])]]),
      source: await sampleFile(),
    });
    useFlashcardsStore.getState().markKnown("upload-x", 1, true);

    const user = userEvent.setup();
    render(<UploadScreen onStudy={vi.fn()} />);
    await screen.findByText("Doomed");

    await user.click(screen.getByRole("button", { name: "Delete Doomed" }));
    await user.click(await screen.findByRole("button", { name: "Delete deck" }));

    await waitFor(async () => expect(await listUploadedDecks()).toHaveLength(0));
    expect(await loadUploadedDeck("upload-x")).toBeUndefined();
    expect(await loadDeckSource("upload-x")).toBeUndefined();
    expect(useFlashcardsStore.getState().knownByDeck["upload-x"]).toBeUndefined();
    await waitFor(() => expect(screen.queryByText("Doomed")).toBeNull());
  });

  it("deleting one deck leaves the others alone", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-a", "Deck A"), media: new Map() });
    await saveUploadedDeck({ deck: deckFixture("upload-b", "Deck B"), media: new Map() });
    useFlashcardsStore.getState().markKnown("upload-b", 3, true);

    const user = userEvent.setup();
    render(<UploadScreen onStudy={vi.fn()} />);
    await screen.findByText("Deck A");

    await user.click(screen.getByRole("button", { name: "Delete Deck A" }));
    await user.click(await screen.findByRole("button", { name: "Delete deck" }));

    await waitFor(async () => expect(await listUploadedDecks()).toHaveLength(1));
    expect((await listUploadedDecks())[0].title).toBe("Deck B");
    expect(await loadUploadedDeck("upload-b")).toBeDefined();
    expect(useFlashcardsStore.getState().knownByDeck["upload-b"]).toEqual([3]);
    expect(screen.getByText("Deck B")).toBeInTheDocument();
  });
});

describe("deleting every deck", () => {
  it("confirms, then clears all decks and all progress", async () => {
    await saveUploadedDeck({
      deck: deckFixture("upload-a", "Deck A"),
      media: new Map(),
      source: await sampleFile(),
    });
    await saveUploadedDeck({ deck: deckFixture("upload-b", "Deck B"), media: new Map() });
    useFlashcardsStore.getState().markKnown("upload-a", 1, true);
    useFlashcardsStore.getState().markKnown("upload-b", 2, true);

    const user = userEvent.setup();
    render(<UploadScreen onStudy={vi.fn()} />);
    await screen.findByText("Deck A");

    await user.click(screen.getByRole("button", { name: /delete all locally saved decks/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Delete all locally saved decks?");
    expect(within(dialog).getByText(/no other site data is touched/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete all decks" }));

    await waitFor(async () => expect(await listUploadedDecks()).toHaveLength(0));
    expect(useFlashcardsStore.getState().knownByDeck).toEqual({});
    await waitFor(() => expect(screen.queryByText("Deck A")).toBeNull());
    expect(screen.queryByText("Deck B")).toBeNull();
  });

  it("is not offered when there is nothing saved", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /delete all locally saved decks/i })).toBeNull();
  });
});

describe("rejecting bad input", () => {
  it("reports the parser's own message for a file that is not a .apkg", async () => {
    // Dropped rather than picked: the input's accept=".apkg" already filters
    // the file picker, so a drop is the path where a wrong extension actually
    // reaches the parser.
    const onStudy = vi.fn();
    render(<UploadScreen onStudy={onStudy} />);

    const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/choose a \.apkg file/i);
    expect(onStudy).not.toHaveBeenCalled();
    expect(await listUploadedDecks()).toHaveLength(0);
  });

  it("reports a .apkg with nothing readable inside", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    await user.upload(
      fileInput(),
      new File([new TextEncoder().encode("this is not a zip")], "broken.apkg")
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onStudy).not.toHaveBeenCalled();
    expect(await listUploadedDecks()).toHaveLength(0);
  });

  it("handles an empty file without crashing or storing anything", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    await user.upload(fileInput(), new File([], "empty.apkg"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onStudy).not.toHaveBeenCalled();
    expect(await listUploadedDecks()).toHaveLength(0);
  });

  it("lets the visitor retry after an error", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    await user.upload(fileInput(), new File([], "empty.apkg"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.upload(fileInput(), await sampleFile());
    await waitFor(() => expect(onStudy).toHaveBeenCalledTimes(1));
    expect(await listUploadedDecks()).toHaveLength(1);
  });
});
