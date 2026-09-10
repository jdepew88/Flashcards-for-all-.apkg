// Extracted from CCNA Practice Labs (ccna-10-week-dev) — src/lib/flashcards/uploaded-decks.ts
// at commit 2a66e957007a9465e5e06042ad8e450b419dd42f.
//
// Stores user-uploaded decks entirely client-side (IndexedDB via idb-keyval).
// Nothing here ever touches a server — decks stay on the visitor's device.
//
// Adapted: the "use client" directive is dropped and the IndexedDB database is
// named for this app rather than for CCNA Practice Labs.

import { createStore, get, set, del } from "idb-keyval";
import type { FlashcardDeck } from "./types";

const dbStore = createStore("flashcard-study-tool", "uploads");

export interface UploadedDeckMeta {
  slug: string;
  title: string;
  cardCount: number;
  chapterCount: number;
  importedAt: number;
}

function deckKey(slug: string) {
  return `deck:${slug}`;
}
function mediaKey(slug: string) {
  return `media:${slug}`;
}
function metaListKey() {
  return "meta-list";
}

export async function listUploadedDecks(): Promise<UploadedDeckMeta[]> {
  const list = (await get<UploadedDeckMeta[]>(metaListKey(), dbStore)) ?? [];
  return list.sort((a, b) => b.importedAt - a.importedAt);
}

export async function saveUploadedDeck(deck: FlashcardDeck, media: Map<string, Blob>): Promise<void> {
  await set(deckKey(deck.slug), deck, dbStore);
  await set(mediaKey(deck.slug), media, dbStore);

  const list = await listUploadedDecks();
  const meta: UploadedDeckMeta = {
    slug: deck.slug,
    title: deck.title,
    cardCount: deck.cardCount,
    chapterCount: deck.chapters.length,
    importedAt: Date.now(),
  };
  await set(metaListKey(), [meta, ...list.filter((d) => d.slug !== deck.slug)], dbStore);
}

export async function loadUploadedDeck(
  slug: string
): Promise<{ deck: FlashcardDeck; media: Map<string, Blob> } | undefined> {
  const [deck, media] = await Promise.all([
    get<FlashcardDeck>(deckKey(slug), dbStore),
    get<Map<string, Blob>>(mediaKey(slug), dbStore),
  ]);
  if (!deck) return undefined;
  return { deck, media: media ?? new Map() };
}

export async function deleteUploadedDeck(slug: string): Promise<void> {
  await del(deckKey(slug), dbStore);
  await del(mediaKey(slug), dbStore);
  const list = await listUploadedDecks();
  await set(
    metaListKey(),
    list.filter((d) => d.slug !== slug),
    dbStore
  );
}