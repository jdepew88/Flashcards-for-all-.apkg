/**
 * Media-query hooks for layout and input decisions.
 *
 * Layout adapts to what the viewport and pointer actually are, never to a
 * user-agent string: a tablet gets tablet controls because it is tablet-sized,
 * and a phone held sideways is still treated as a phone because its short edge
 * and coarse pointer say so.
 */

import { useCallback, useSyncExternalStore } from "react";

/**
 * Phone-sized: narrow, or a touch device held in landscape (short and coarse).
 * Gesture-first study controls apply here; everything larger shows buttons.
 */
export const COMPACT_QUERY = "(max-width: 639.98px), (max-height: 500px) and (pointer: coarse)";

/** A mouse or trackpad: worth showing keyboard-shortcut hints. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener?.("change", onChange);
      return () => list.removeEventListener?.("change", onChange);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => matches(query),
    () => false
  );
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

/**
 * A phone held sideways: little height to spare. Combined with COMPACT_QUERY,
 * it moves Buttons-mode controls from a bottom strip to rails at either side,
 * where landscape has room and thumbs already rest.
 */
export const PHONE_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";
