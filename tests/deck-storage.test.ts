/**
 * Browser-local deck persistence.
 *
 * These run against a real IndexedDB implementation (fake-indexeddb), not a
 * mock, so what is asserted here is what the storage layer actually does:
 * decks survive a "reload", deletion is exhaustive, and one deck's removal
 * never touches another's.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStore, del, get, keys, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DB_NAME,
  STORE_NAME,
  MAX_RETAINED_SOURCE_BYTES,
  deleteAllUploadedDecks,
  deleteUploadedDeck,
  listUploadedDecks,
  loadDeckSource,
  loadUploadedDeck,
  pruneOrphanedDeckData,
  saveUploadedDeck,
} from "@/lib/flashcards/uploaded-decks";
import {
  deleteAllDeckProgress,
  deleteDeckProgress,
  useFlashcardsStore,
} from "@/lib/stores/known-store";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const SAMPLE_PATH = resolve(process.cwd(), "public/sample-deck.apkg");
const rawStore = createStore(DB_NAME, STORE_NAME);

function deckFixture(slug: string, title: string, cards = 2): FlashcardDeck {
  return {
    slug,
    title,
    cardCount: cards,
    chapters: [{ id: "Ch", name: "Ch", cardCount: cards }],
    cards: Array.from({ length: cards }, (_, i) => ({
      id: i + 1,
      chapter: "Ch",
      tags: [],
      front: `<p>Front ${i}</p>`,
      back: `<p>Back ${i}</p>`,
    })),
  };
}

function mediaFixture(): Map<string, Blob> {
  return new Map([["diagram.png", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })]]);
}

async function sampleFile(name = "sample-deck.apkg"): Promise<File> {
  const bytes = await readFile(SAMPLE_PATH);
  return new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });
}

/** Every key the app currently holds in its own object store. */
async function allKeys(): Promise<string[]> {
  return (await keys(rawStore)).filter((k): k is string => typeof k === "string").sort();
}

beforeEach(async () => {
  await deleteAllUploadedDecks();
  deleteAllDeckProgress();
});

afterEach(async () => {
  await deleteAllUploadedDecks();
});

describe("importing and persisting", () => {
  it("saves a deck, its media and its original .apkg", async () => {
    const source = await sampleFile();
    const meta = await saveUploadedDeck({
      deck: deckFixture("upload-a", "Deck A"),
      media: mediaFixture(),
      source,
    });

    expect(meta.slug).toBe("upload-a");
    expect(meta.cardCount).toBe(2);
    expect(meta.chapterCount).toBe(1);
    expect(meta.fileName).toBe("sample-deck.apkg");
    expect(meta.fileSize).toBe(source.size);
    expect(meta.hasSource).toBe(true);

    expect(await allKeys()).toEqual([
      "deck:upload-a",
      "media:upload-a",
      "meta-list",
      "source:upload-a",
    ]);
  });

  it("lists saved decks newest first", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-old", "Older"), media: new Map() });
    await new Promise((r) => setTimeout(r, 2));
    await saveUploadedDeck({ deck: deckFixture("upload-new", "Newer"), media: new Map() });

    expect((await listUploadedDecks()).map((d) => d.title)).toEqual(["Newer", "Older"]);
  });

  it("reopens a saved deck without the original file being selected again", async () => {
    await saveUploadedDeck({
      deck: deckFixture("upload-a", "Deck A", 3),
      media: mediaFixture(),
      source: await sampleFile(),
    });

    // Stands in for a fresh visit: nothing in memory, only what IndexedDB holds.
    const reopened = await loadUploadedDeck("upload-a");

    expect(reopened).toBeDefined();
    expect(reopened!.deck.cards).toHaveLength(3);
    expect(reopened!.deck.title).toBe("Deck A");
    expect(reopened!.media.get("diagram.png")).toBeInstanceOf(Blob);
    expect(await reopened!.media.get("diagram.png")!.arrayBuffer()).toEqual(
      new Uint8Array([137, 80, 78, 71]).buffer
    );
  });

  it("returns the original .apkg byte for byte", async () => {
    const source = await sampleFile();
    await saveUploadedDeck({ deck: deckFixture("upload-a", "Deck A"), media: new Map(), source });

    const stored = await loadDeckSource("upload-a");

    expect(stored).toBeInstanceOf(Blob);
    expect(stored!.size).toBe(source.size);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(
      new Uint8Array(await source.arrayBuffer())
    );
  });

  it("re-importing the same slug replaces rather than duplicates it", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-a", "First"), media: new Map() });
    await saveUploadedDeck({ deck: deckFixture("upload-a", "Second", 5), media: new Map() });

    const list = await listUploadedDecks();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Second");
    expect((await loadUploadedDeck("upload-a"))!.deck.cards).toHaveLength(5);
  });

  it("skips retaining the original when it is very large", async () => {
    // Only `size` is read before the decision, so a stub avoids allocating 80MB.
    const huge = {
      name: "huge.apkg",
      size: MAX_RETAINED_SOURCE_BYTES + 1,
      type: "application/octet-stream",
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as File;

    const meta = await saveUploadedDeck({
      deck: deckFixture("upload-big", "Big"),
      media: new Map(),
      source: huge,
    });

    expect(meta.hasSource).toBe(false);
    expect(await loadDeckSource("upload-big")).toBeUndefined();
    // The deck itself is still fully usable.
    expect(await loadUploadedDeck("upload-big")).toBeDefined();
  });

  it("reports nothing for a deck that was never saved", async () => {
    expect(await loadUploadedDeck("upload-nope")).toBeUndefined();
    expect(await loadDeckSource("upload-nope")).toBeUndefined();
  });
});

describe("deleting one deck", () => {
  it("removes the deck, its media, its original file and its library entry", async () => {
    await saveUploadedDeck({
      deck: deckFixture("upload-a", "Deck A"),
      media: mediaFixture(),
      source: await sampleFile(),
    });

    await deleteUploadedDeck("upload-a");

    expect(await listUploadedDecks()).toEqual([]);
    expect(await loadUploadedDeck("upload-a")).toBeUndefined();
    expect(await loadDeckSource("upload-a")).toBeUndefined();
    // Nothing orphaned: only the (now empty) library index remains.
    expect(await allKeys()).toEqual(["meta-list"]);
  });

  it("removes that deck's study progress", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-a", "Deck A"), media: new Map() });
    useFlashcardsStore.getState().markKnown("upload-a", 1, true);
    useFlashcardsStore.getState().markKnown("upload-a", 2, true);
    expect(useFlashcardsStore.getState().knownByDeck["upload-a"]).toEqual([1, 2]);

    await deleteUploadedDeck("upload-a");
    deleteDeckProgress("upload-a");

    expect(useFlashcardsStore.getState().knownByDeck["upload-a"]).toBeUndefined();
  });

  it("leaves other decks and their progress completely intact", async () => {
    await saveUploadedDeck({
      deck: deckFixture("upload-a", "Deck A"),
      media: mediaFixture(),
      source: await sampleFile("a.apkg"),
    });
    await saveUploadedDeck({
      deck: deckFixture("upload-b", "Deck B"),
      media: mediaFixture(),
      source: await sampleFile("b.apkg"),
    });
    useFlashcardsStore.getState().markKnown("upload-a", 1, true);
    useFlashcardsStore.getState().markKnown("upload-b", 7, true);

    await deleteUploadedDeck("upload-a");
    deleteDeckProgress("upload-a");

    expect((await listUploadedDecks()).map((d) => d.slug)).toEqual(["upload-b"]);
    expect(await loadUploadedDeck("upload-b")).toBeDefined();
    expect(await loadDeckSource("upload-b")).toBeInstanceOf(Blob);
    expect(useFlashcardsStore.getState().knownByDeck["upload-b"]).toEqual([7]);
    expect(await allKeys()).toEqual([
      "deck:upload-b",
      "media:upload-b",
      "meta-list",
      "source:upload-b",
    ]);
  });

  it("is a no-op for a deck that does not exist", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-a", "Deck A"), media: new Map() });

    await expect(deleteUploadedDeck("upload-missing")).resolves.toBeUndefined();
    expect(await listUploadedDecks()).toHaveLength(1);
  });
});

describe("deleting every deck", () => {
  it("removes all decks, media, originals and progress", async () => {
    await saveUploadedDeck({
      deck: deckFixture("upload-a", "Deck A"),
      media: mediaFixture(),
      source: await sampleFile("a.apkg"),
    });
    await saveUploadedDeck({
      deck: deckFixture("upload-b", "Deck B"),
      media: mediaFixture(),
      source: await sampleFile("b.apkg"),
    });
    useFlashcardsStore.getState().markKnown("upload-a", 1, true);
    useFlashcardsStore.getState().markKnown("upload-b", 2, true);

    const removed = await deleteAllUploadedDecks();
    removed.forEach(deleteDeckProgress);

    expect(removed.sort()).toEqual(["upload-a", "upload-b"]);
    expect(await listUploadedDecks()).toEqual([]);
    expect(await loadUploadedDeck("upload-a")).toBeUndefined();
    expect(await loadUploadedDeck("upload-b")).toBeUndefined();
    expect(await loadDeckSource("upload-a")).toBeUndefined();
    expect(await allKeys()).toEqual(["meta-list"]);
    expect(useFlashcardsStore.getState().knownByDeck).toEqual({});
  });

  it("touches only keys this application owns", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-a", "Deck A"), media: new Map() });
    // A key written by something else that happens to share the object store.
    await set("unrelated:setting", { keep: true }, rawStore);

    await deleteAllUploadedDecks();

    expect(await get("unrelated:setting", rawStore)).toEqual({ keep: true });
    expect(await allKeys()).toEqual(["meta-list", "unrelated:setting"]);

    // Surviving deleteAll is the point of this test, so it also has to be
    // cleaned up by hand — the app's own teardown will not touch it.
    await del("unrelated:setting", rawStore);
  });
});

describe("orphan cleanup", () => {
  it("removes deck data with no library entry", async () => {
    await saveUploadedDeck({ deck: deckFixture("upload-a", "Deck A"), media: new Map() });
    // Simulates an import that died between writing the deck and recording it.
    await set("deck:upload-ghost", deckFixture("upload-ghost", "Ghost"), rawStore);
    await set("media:upload-ghost", new Map(), rawStore);
    await set("source:upload-ghost", { type: "", bytes: new ArrayBuffer(4) }, rawStore);

    const pruned = await pruneOrphanedDeckData();

    expect(pruned).toBe(3);
    expect(await allKeys()).toEqual(["deck:upload-a", "media:upload-a", "meta-list"]);
  });

  it("leaves healthy decks alone", async () => {
    await saveUploadedDeck({
      deck: deckFixture("upload-a", "Deck A"),
      media: mediaFixture(),
      source: await sampleFile(),
    });

    expect(await pruneOrphanedDeckData()).toBe(0);
    expect(await loadUploadedDeck("upload-a")).toBeDefined();
  });
});
