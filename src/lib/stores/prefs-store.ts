// Adapted from CCNA Practice Labs — src/lib/progress/flashcard-prefs-store.ts.
// Only the persisted key name changed, so a visitor's CCNA preferences and
// their preferences here never collide in localStorage.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FlashcardFontId } from "@/lib/fonts";

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 26;
export const DEFAULT_FONT_SIZE = 17;

interface FlashcardPrefsState {
  font: FlashcardFontId;
  fontSize: number;
  setFont: (font: FlashcardFontId) => void;
  setFontSize: (size: number) => void;
}

export const useFlashcardPrefsStore = create<FlashcardPrefsState>()(
  persist(
    (set) => ({
      font: "sans",
      fontSize: DEFAULT_FONT_SIZE,
      setFont: (font) => set({ font }),
      setFontSize: (size) =>
        set({ fontSize: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size)) }),
    }),
    { name: "flashcard-prefs-v1" }
  )
);
