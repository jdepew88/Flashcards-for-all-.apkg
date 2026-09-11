/**
 * Where the app is running, and what the browser lets it do about its chrome.
 *
 * "Full screen" covers two different things here:
 *
 *   1. Immersive study mode — the app hiding its own chrome (header, deck
 *      title, counts) so the card gets the screen. Always available.
 *   2. The browser's chrome — address bar and toolbars. A page can only hide
 *      that through the Fullscreen API, and only after a user gesture. iPhone
 *      browsers do not offer the API to pages at all; there, the way to lose
 *      the browser chrome is to open the site from the Home Screen, where it
 *      runs as a standalone web app (see public/manifest.webmanifest).
 *
 * Everything below is feature detection. Nothing reads the user-agent string:
 * "Chrome" on an iPhone is WebKit with Apple's rules, and says so only through
 * what it supports.
 */

import { useMediaQuery } from "@/lib/use-media-query";

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type HomeScreenNavigator = Navigator & { standalone?: boolean };

/**
 * Running as an installed app. `standalone` is what the manifest asks for;
 * `minimal-ui` is an installed app that kept a small browser bar. Deliberately
 * not `fullscreen`: some browsers match it for an ordinary tab that is merely
 * in browser full screen, which is not "installed".
 */
export const INSTALLED_QUERY = "(display-mode: standalone), (display-mode: minimal-ui)";

/** True when the page may take the whole screen through the Fullscreen API. */
export function fullscreenAvailable(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as FullscreenDocument;
  const root = document.documentElement as FullscreenCapableElement;
  if (doc.fullscreenEnabled === true && typeof root.requestFullscreen === "function") return true;
  // iPadOS Safari and older WebKit expose only the prefixed form.
  return doc.webkitFullscreenEnabled === true && typeof root.webkitRequestFullscreen === "function";
}

export function fullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Asks the browser to hide its chrome. Must be called synchronously from a
 * user gesture. Refusal is a normal outcome, not an error: immersive mode
 * still hides the app's own chrome, so the rejection is swallowed.
 */
export function enterBrowserFullscreen(): void {
  if (!fullscreenAvailable()) return;
  const root = document.documentElement as FullscreenCapableElement;
  try {
    const result =
      typeof root.requestFullscreen === "function"
        ? root.requestFullscreen({ navigationUI: "hide" })
        : root.webkitRequestFullscreen?.();
    if (result instanceof Promise) result.catch(() => {});
  } catch {
    // Some engines throw synchronously when not allowed; same outcome.
  }
}

export function exitBrowserFullscreen(): void {
  if (!fullscreenElement()) return;
  const doc = document as FullscreenDocument;
  try {
    const result = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
    if (result instanceof Promise) result.catch(() => {});
  } catch {
    // Already gone.
  }
}

export function onFullscreenChange(listener: () => void): () => void {
  document.addEventListener("fullscreenchange", listener);
  document.addEventListener("webkitfullscreenchange", listener);
  return () => {
    document.removeEventListener("fullscreenchange", listener);
    document.removeEventListener("webkitfullscreenchange", listener);
  };
}

/** Launched from the Home Screen or as an installed app. For messaging only. */
export function isInstalledDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if ((navigator as HomeScreenNavigator).standalone === true) return true;
  return typeof window.matchMedia === "function" && window.matchMedia(INSTALLED_QUERY).matches;
}

export function useInstalledDisplay(): boolean {
  const installed = useMediaQuery(INSTALLED_QUERY);
  return installed || (typeof navigator !== "undefined" && (navigator as HomeScreenNavigator).standalone === true);
}

/**
 * The Home Screen is the only route to a browser-chrome-free study screen:
 * an iOS/iPadOS browser (which exposes `navigator.standalone`, true or false)
 * whose pages cannot use the Fullscreen API, running in an ordinary tab.
 * That is an iPhone, identified by what it can do rather than by its name.
 */
export function homeScreenIsTheWayToFullscreen(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "standalone" in navigator &&
    !isInstalledDisplay() &&
    !fullscreenAvailable()
  );
}
