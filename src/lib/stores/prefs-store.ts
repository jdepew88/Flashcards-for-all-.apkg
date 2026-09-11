// Adapted from CCNA Practice Labs — src/lib/progress/flashcard-prefs-store.ts.
// The persisted key name changed so a visitor's CCNA preferences and their
// preferences here never collide in localStorage.
//
// Added for the standalone build: how phone-sized screens are operated
// (gestures or on-screen buttons), whether the one-time gesture hint has done
// its job, what links inside imported cards do, and whether the one-time
// "add to Home Screen" tip has been shown. All of it lives here, in the same
// browser-local store as the reading options — nothing about preferences ever
// leaves the device. New fields fall back to their defaults for anyone whose
// stored preferences predate them (persist merges stored over initial state).

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FlashcardFontId } from "@/lib/fonts";
import type { CardLinkMode } from "@/lib/flashcards/card-links";

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 26;
export const DEFAULT_FONT_SIZE = 19;

/** Phone-sized screens only. Larger layouts always show buttons. */
export type ControlMode = "gestures" | "buttons";

interface FlashcardPrefsState {
  font: FlashcardFontId;
  fontSize: number;
  controlMode: ControlMode;
  gestureHintSeen: boolean;
  /** Links inside imported card content. Off by default: see card-links.ts. */
  cardLinks: CardLinkMode;
  homeScreenTipSeen: boolean;
  setFont: (font: FlashcardFontId) => void;
  setFontSize: (size: number) => void;
  setControlMode: (mode: ControlMode) => void;
  markGestureHintSeen: () => void;
  setCardLinks: (mode: CardLinkMode) => void;
  markHomeScreenTipSeen: () => void;
}

export const useFlashcardPrefsStore = create<FlashcardPrefsState>()(
  persist(
    (set) => ({
      font: "sans",
      fontSize: DEFAULT_FONT_SIZE,
      controlMode: "gestures",
      gestureHintSeen: false,
      cardLinks: "disabled",
      homeScreenTipSeen: false,
      setFont: (font) => set({ font }),
      setFontSize: (size) =>
        set({ fontSize: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size)) }),
      setControlMode: (controlMode) => set({ controlMode }),
      markGestureHintSeen: () => set({ gestureHintSeen: true }),
      setCardLinks: (cardLinks) => set({ cardLinks }),
      markHomeScreenTipSeen: () => set({ homeScreenTipSeen: true }),
    }),
    { name: "flashcard-prefs-v1" }
  )
);
