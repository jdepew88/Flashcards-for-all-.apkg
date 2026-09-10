// Adapted from CCNA Practice Labs — src/lib/progress/flashcard-prefs-store.ts.
// The persisted key name changed so a visitor's CCNA preferences and their
// preferences here never collide in localStorage.
//
// Added for the standalone build: how phone-sized screens are operated
// (gestures or on-screen buttons) and whether the one-time gesture hint has
// done its job. Both live here, in the same browser-local store as the reading
// options — nothing about preferences ever leaves the device.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FlashcardFontId } from "@/lib/fonts";

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
  setFont: (font: FlashcardFontId) => void;
  setFontSize: (size: number) => void;
  setControlMode: (mode: ControlMode) => void;
  markGestureHintSeen: () => void;
}

export const useFlashcardPrefsStore = create<FlashcardPrefsState>()(
  persist(
    (set) => ({
      font: "sans",
      fontSize: DEFAULT_FONT_SIZE,
      controlMode: "gestures",
      gestureHintSeen: false,
      setFont: (font) => set({ font }),
      setFontSize: (size) =>
        set({ fontSize: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size)) }),
      setControlMode: (controlMode) => set({ controlMode }),
      markGestureHintSeen: () => set({ gestureHintSeen: true }),
    }),
    { name: "flashcard-prefs-v1" }
  )
);
