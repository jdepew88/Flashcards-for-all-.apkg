// Adapted from CCNA Practice Labs — src/lib/progress/flashcards-store.ts.
// Same shape and same actions; only the persisted key name changed.
//
// `resetDeck` existed in the original store but was never wired to a control.
// The standalone viewer exposes it as "Reset progress" in the options sheet,
// since there is no account-level progress reset to fall back on here.

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FlashcardsState {
  knownByDeck: Record<string, number[]>;
  markKnown: (deckSlug: string, cardId: number, known: boolean) => void;
  resetDeck: (deckSlug: string) => void;
  resetAllDecks: () => void;
}

/**
 * Clears one deck's progress from outside React.
 *
 * Deck deletion runs in an async handler, not a component, and must remove the
 * progress record along with the deck — otherwise re-importing the same file
 * would silently inherit the old deck's "known" marks.
 */
export function deleteDeckProgress(deckSlug: string): void {
  useFlashcardsStore.getState().resetDeck(deckSlug);
}

/** Clears progress for every deck. Used by "Delete all locally saved decks". */
export function deleteAllDeckProgress(): void {
  useFlashcardsStore.getState().resetAllDecks();
}

export const useFlashcardsStore = create<FlashcardsState>()(
  persist(
    (set, get) => ({
      knownByDeck: {},

      markKnown: (deckSlug, cardId, known) => {
        const current = get().knownByDeck[deckSlug] ?? [];
        const withoutCard = current.filter((id) => id !== cardId);
        const next = known ? [...withoutCard, cardId] : withoutCard;
        set({ knownByDeck: { ...get().knownByDeck, [deckSlug]: next } });
      },

      resetDeck: (deckSlug) => {
        const rest = { ...get().knownByDeck };
        delete rest[deckSlug];
        set({ knownByDeck: rest });
      },

      resetAllDecks: () => set({ knownByDeck: {} }),
    }),
    { name: "flashcards-known-v1" }
  )
);
