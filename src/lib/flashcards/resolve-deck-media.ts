// Extracted from CCNA Practice Labs — the `resolveDeckMedia` helper in
// src/components/flashcards/flashcard-study-client.tsx.
//
// Lives in its own module here rather than beside the component so the study
// screen exports nothing but a component (React Fast Refresh requirement).

import { resolveCardMedia } from "./anki-template";
import type { Flashcard, FlashcardDeck } from "./types";

/**
 * Rewrites the bare media filenames inside a deck's card HTML to point at
 * blob: URLs made from the deck's own extracted files.
 */
export function resolveDeckMedia(
  deck: FlashcardDeck,
  mediaUrls: Map<string, string>
): FlashcardDeck {
  const resolve = (filename: string) => mediaUrls.get(filename);
  const cards: Flashcard[] = deck.cards.map((card) => ({
    ...card,
    front: resolveCardMedia(card.front, resolve),
    back: resolveCardMedia(card.back, resolve),
  }));
  return { ...deck, cards };
}
