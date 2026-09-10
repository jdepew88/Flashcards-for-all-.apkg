// Extracted from CCNA Practice Labs (ccna-10-week-dev) — src/lib/flashcards/uploaded-decks.ts
// at commit 2a66e957007a9465e5e06042ad8e450b419dd42f, then extended.
//
// Stores imported decks entirely client-side (IndexedDB via idb-keyval).
// Nothing here ever touches a server — decks stay on the visitor's device.
//
// ## What is stored, and where
//
// One IndexedDB database, `flashcard-study-tool`, with one object store,
// `uploads`, holding these keys:
//
//   meta-list       UploadedDeckMeta[]      the deck library, newest first
//   deck:<slug>     FlashcardDeck           parsed + sanitized cards
//   media:<slug>    Map<string, Blob>       media extracted from the .apkg
//   source:<slug>   Blob                    the original .apkg, byte for byte
//
// Study progress does not live here: it stays in the Zustand store's
// localStorage key (`flashcards-known-v1`), which is where the CCNA build kept
// it. Deleting a deck clears its progress too — see `deleteDeckProgress` in
// src/lib/stores/known-store.ts, which this module's callers invoke.
//
// ## Why keep the original .apkg as well as the parsed deck
//
// It roughly doubles what a deck costs, since the parsed cards are the
// decompressed form of the same content. It buys two things worth having:
// "Download original .apkg", so a deck imported on this device is not lost if
// the user misplaces their copy; and the ability to re-parse an old deck with
// a newer parser or sanitizer without asking for the file again. Decks over
// MAX_RETAINED_SOURCE_BYTES skip it — at that size the parsed deck is what
// matters and the quota is better spent on it.
//
// Adapted from the CCNA original: the "use client" directive is dropped, the
// database is named for this app, the original .apkg blob and richer metadata
// are retained, and deleting is exhaustive.

import { createStore, del, get, keys, set } from "idb-keyval";
import type { FlashcardDeck } from "./types";

export const DB_NAME = "flashcard-study-tool";
export const STORE_NAME = "uploads";

const dbStore = createStore(DB_NAME, STORE_NAME);

/**
 * Above this, the original .apkg is not retained. 75MB of source alongside its
 * parsed form is already a lot to ask of an origin's quota, and the parsed deck
 * is the part the app actually needs.
 */
export const MAX_RETAINED_SOURCE_BYTES = 75 * 1024 * 1024;

export interface UploadedDeckMeta {
  slug: string;
  title: string;
  cardCount: number;
  chapterCount: number;
  importedAt: number;
  /** Name of the file the user picked, kept for the download action. */
  fileName?: string;
  /** Size of that file in bytes. */
  fileSize?: number;
  /** Whether the original .apkg was retained (see MAX_RETAINED_SOURCE_BYTES). */
  hasSource?: boolean;
}

const META_LIST_KEY = "meta-list";

/**
 * How binary data is written to IndexedDB.
 *
 * Blobs are stored as raw bytes plus their MIME type rather than as Blob
 * objects. Blob support in IndexedDB is patchy — some engines have historically
 * mishandled Blobs that outlive the page, and structured-clone implementations
 * disagree about them — whereas an ArrayBuffer is cloneable everywhere. The
 * Blob is rebuilt on read, so nothing outside this module notices.
 */
interface StoredBinary {
  type: string;
  bytes: ArrayBuffer;
}

async function toStored(blob: Blob): Promise<StoredBinary> {
  return { type: blob.type, bytes: await blob.arrayBuffer() };
}

/** Rebuilds a Blob, tolerating records written before the bytes+type change. */
function fromStored(value: StoredBinary | Blob | undefined): Blob | undefined {
  if (!value) return undefined;
  if (value instanceof Blob) return value;
  if (!("bytes" in value)) return undefined;
  return new Blob([value.bytes], { type: value.type });
}

const deckKey = (slug: string) => `deck:${slug}`;
const mediaKey = (slug: string) => `media:${slug}`;
const sourceKey = (slug: string) => `source:${slug}`;

/** Every key prefix this application owns, for exhaustive and scoped deletion. */
const OWNED_PREFIXES = ["deck:", "media:", "source:"] as const;

export async function listUploadedDecks(): Promise<UploadedDeckMeta[]> {
  const list = (await get<UploadedDeckMeta[]>(META_LIST_KEY, dbStore)) ?? [];
  return [...list].sort((a, b) => b.importedAt - a.importedAt);
}

export interface SaveDeckInput {
  deck: FlashcardDeck;
  media: Map<string, Blob>;
  /** The file the user picked. Retained as a Blob unless it is very large. */
  source?: File;
}

export async function saveUploadedDeck({ deck, media, source }: SaveDeckInput): Promise<UploadedDeckMeta> {
  const retainSource = !!source && source.size <= MAX_RETAINED_SOURCE_BYTES;

  const storedMedia = new Map<string, StoredBinary>();
  for (const [filename, blob] of media) {
    storedMedia.set(filename, await toStored(blob));
  }

  await set(deckKey(deck.slug), deck, dbStore);
  await set(mediaKey(deck.slug), storedMedia, dbStore);
  if (retainSource && source) {
    await set(sourceKey(deck.slug), await toStored(source), dbStore);
  }

  const meta: UploadedDeckMeta = {
    slug: deck.slug,
    title: deck.title,
    cardCount: deck.cardCount,
    chapterCount: deck.chapters.length,
    importedAt: Date.now(),
    fileName: source?.name,
    fileSize: source?.size,
    hasSource: retainSource,
  };

  const list = await listUploadedDecks();
  await set(META_LIST_KEY, [meta, ...list.filter((d) => d.slug !== deck.slug)], dbStore);

  return meta;
}

export async function loadUploadedDeck(
  slug: string
): Promise<{ deck: FlashcardDeck; media: Map<string, Blob> } | undefined> {
  const [deck, storedMedia] = await Promise.all([
    get<FlashcardDeck>(deckKey(slug), dbStore),
    get<Map<string, StoredBinary | Blob>>(mediaKey(slug), dbStore),
  ]);
  if (!deck) return undefined;

  const media = new Map<string, Blob>();
  for (const [filename, value] of storedMedia ?? []) {
    const blob = fromStored(value);
    if (blob) media.set(filename, blob);
  }

  return { deck, media };
}

/** The original .apkg for a deck, if it was retained. */
export async function loadDeckSource(slug: string): Promise<Blob | undefined> {
  return fromStored(await get<StoredBinary | Blob>(sourceKey(slug), dbStore));
}

/**
 * Removes every trace of one deck: parsed cards, extracted media, the original
 * .apkg, and its entry in the library. Study progress is cleared by the caller
 * (it lives in localStorage, not here).
 */
export async function deleteUploadedDeck(slug: string): Promise<void> {
  await Promise.all([
    del(deckKey(slug), dbStore),
    del(mediaKey(slug), dbStore),
    del(sourceKey(slug), dbStore),
  ]);

  const list = await listUploadedDecks();
  await set(
    META_LIST_KEY,
    list.filter((d) => d.slug !== slug),
    dbStore
  );
}

/**
 * Removes every deck this application owns.
 *
 * Deliberately enumerates and deletes only keys this app wrote, rather than
 * calling `clear()` on the store or deleting the database. The effect is the
 * same today, but it keeps the blast radius defined: nothing outside the
 * documented prefixes is touched, and no unrelated site data is involved.
 *
 * Returns the slugs removed, so the caller can clear their progress too.
 */
export async function deleteAllUploadedDecks(): Promise<string[]> {
  const removed = (await listUploadedDecks()).map((d) => d.slug);

  const allKeys = await keys(dbStore);
  const owned = allKeys.filter(
    (key): key is string =>
      typeof key === "string" && OWNED_PREFIXES.some((prefix) => key.startsWith(prefix))
  );

  await Promise.all(owned.map((key) => del(key, dbStore)));
  await set(META_LIST_KEY, [], dbStore);

  return removed;
}

/**
 * Drops orphaned records — a `deck:`/`media:`/`source:` key with no entry in
 * the library. Nothing should create one, but an import interrupted between
 * writing a deck and updating the library would, and an orphan is invisible
 * storage the user cannot delete from the UI.
 *
 * Returns the number of keys removed.
 */
export async function pruneOrphanedDeckData(): Promise<number> {
  const known = new Set((await listUploadedDecks()).map((d) => d.slug));
  const allKeys = await keys(dbStore);

  const orphans = allKeys.filter((key): key is string => {
    if (typeof key !== "string") return false;
    const prefix = OWNED_PREFIXES.find((p) => key.startsWith(p));
    if (!prefix) return false;
    return !known.has(key.slice(prefix.length));
  });

  await Promise.all(orphans.map((key) => del(key, dbStore)));
  return orphans.length;
}
