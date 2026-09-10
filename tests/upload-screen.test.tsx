/**
 * The landing / upload screen: what a first-time visitor is told, what happens
 * to a good file, and what happens to a bad one.
 *
 * The IndexedDB layer is mocked — jsdom has no IndexedDB, and what matters here
 * is that the screen calls the real parser and reports its real errors.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const WASM_PATH = resolve(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm");
const SAMPLE_PATH = resolve(process.cwd(), "public/sample-deck.apkg");

const saved: FlashcardDeck[] = [];
let stored: Array<{
  slug: string;
  title: string;
  cardCount: number;
  chapterCount: number;
  importedAt: number;
}> = [];

vi.mock("@/lib/flashcards/uploaded-decks", () => ({
  listUploadedDecks: async () => stored,
  saveUploadedDeck: async (deck: FlashcardDeck) => {
    saved.push(deck);
    stored = [
      {
        slug: deck.slug,
        title: deck.title,
        cardCount: deck.cardCount,
        chapterCount: deck.chapters.length,
        importedAt: Date.now(),
      },
      ...stored.filter((d) => d.slug !== deck.slug),
    ];
  },
  deleteUploadedDeck: async (slug: string) => {
    stored = stored.filter((d) => d.slug !== slug);
  },
}));

// The screen calls parseApkgFile with the browser's default wasm URL; in jsdom
// there is no server to fetch it from, so point sql.js at node_modules while
// leaving every other part of the parser untouched.
vi.mock("@/lib/flashcards/client-import", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/flashcards/client-import")>();
  return {
    ...actual,
    parseApkgFile: (
      file: File,
      onProgress?: (message: string) => void,
      options?: { wasmUrl?: string }
    ) => actual.parseApkgFile(file, onProgress, { wasmUrl: options?.wasmUrl ?? WASM_PATH }),
  };
});

const { UploadScreen } = await import("@/components/upload-screen");

async function sampleFile(): Promise<File> {
  const bytes = await readFile(SAMPLE_PATH);
  return new File([new Uint8Array(bytes)], "sample-deck.apkg");
}

beforeEach(() => {
  saved.length = 0;
  stored = [];
});

afterEach(cleanup);

describe("what the page says", () => {
  it("leads with the title, the promise and the primary action", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Flashcard Study Tool" })).toBeInTheDocument();
    expect(
      screen.getByText(/Upload a compatible flashcard deck and study it directly in your browser/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Drop a \.apkg file here, or tap to choose one/i)).toBeInTheDocument();
  });

  it("states the privacy behavior the implementation actually has", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(
      screen.getByText(
        /Your flashcard file is processed locally in your browser and is not uploaded to a server/i
      )
    ).toBeInTheDocument();
  });

  it("names the one accepted file type on the control itself", () => {
    render(<UploadScreen onStudy={vi.fn()} />);

    expect(document.querySelector<HTMLInputElement>("#apkg-upload")!.accept).toBe(".apkg");
    expect(screen.getByRole("heading", { name: /supported file format/i })).toBeInTheDocument();
  });
});

describe("a valid upload", () => {
  it("parses the file, stores it, and starts the study session", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    await user.upload(document.querySelector<HTMLInputElement>("#apkg-upload")!, await sampleFile());

    await waitFor(() => expect(onStudy).toHaveBeenCalledTimes(1));
    expect(saved).toHaveLength(1);
    expect(saved[0].cards).toHaveLength(6);
    expect(onStudy).toHaveBeenCalledWith(saved[0].slug);
  });

  it("accepts a file dropped onto the target", async () => {
    const onStudy = vi.fn();
    render(<UploadScreen onStudy={onStudy} />);
    const file = await sampleFile();

    const dropZone = document.querySelector('label[for="apkg-upload"]')!;
    fireEvent.dragOver(dropZone, { dataTransfer: { files: [file] } });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onStudy).toHaveBeenCalledTimes(1));
    expect(saved).toHaveLength(1);
  });

  it("lists decks already on this device and can remove one", async () => {
    stored = [
      { slug: "upload-x", title: "Earlier Deck", cardCount: 12, chapterCount: 2, importedAt: 1 },
    ];
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    expect(await screen.findByText("Earlier Deck")).toBeInTheDocument();
    expect(screen.getByText("12 cards · 2 chapters")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Study" }));
    expect(onStudy).toHaveBeenCalledWith("upload-x");

    await user.click(screen.getByRole("button", { name: "Delete Earlier Deck" }));
    await waitFor(() => expect(screen.queryByText("Earlier Deck")).not.toBeInTheDocument());
  });
});

describe("an invalid upload", () => {
  it("reports the parser's own message for a file that is not a .apkg", async () => {
    // Dropped rather than picked: the input's accept=".apkg" already filters
    // the file picker, so a drop is the path where a wrong extension actually
    // reaches the parser.
    const onStudy = vi.fn();
    render(<UploadScreen onStudy={onStudy} />);

    const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    fireEvent.drop(document.querySelector('label[for="apkg-upload"]')!, {
      dataTransfer: { files: [file] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/choose a \.apkg file/i);
    expect(onStudy).not.toHaveBeenCalled();
  });

  it("reports a .apkg with nothing readable inside", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    await user.upload(
      document.querySelector<HTMLInputElement>("#apkg-upload")!,
      new File([new TextEncoder().encode("this is not a zip")], "broken.apkg")
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onStudy).not.toHaveBeenCalled();
  });

  it("handles an empty file without crashing", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);

    await user.upload(document.querySelector<HTMLInputElement>("#apkg-upload")!, new File([], "empty.apkg"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onStudy).not.toHaveBeenCalled();
  });

  it("lets the visitor retry after an error", async () => {
    const onStudy = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onStudy={onStudy} />);
    const input = document.querySelector<HTMLInputElement>("#apkg-upload")!;

    await user.upload(input, new File([], "empty.apkg"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.upload(input, await sampleFile());
    await waitFor(() => expect(onStudy).toHaveBeenCalledTimes(1));
  });
});
