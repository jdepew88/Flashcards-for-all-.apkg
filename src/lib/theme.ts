/**
 * Colour theme: Light or Dark.
 *
 * Same paradigm as Quiz on Demand. An explicit choice is remembered in
 * localStorage on this device only — it is never sent anywhere. Until the
 * visitor makes one, the page follows the operating system.
 *
 * Attribute contract, shared with public/theme-init.js (which applies a stored
 * choice before first paint, so there is no flash of the wrong theme):
 *
 *   explicit "light" / "dark"  ->  <html data-theme="light" | "dark">
 *   no stored choice           ->  no data-theme; CSS follows prefers-color-scheme
 *
 * Leaving the no-choice state attribute-free means the OS can switch themes live
 * with no JavaScript at all: the CSS media query does it.
 */

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Must match the key in public/theme-init.js. tests/theme.test.tsx enforces it. */
export const THEME_STORAGE_KEY = "flashcards:theme";

/** Browser-chrome colours (mobile address bar), matched to --background in styles.css. */
export const THEME_COLORS = { light: "#f3f2ec", dark: "#101412" } as const;

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    // Storage can be blocked (private browsing, site-data settings).
    return null;
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches
    ? "dark"
    : "light";
}

/** The theme actually on screen: the stored choice, else the OS preference. */
export function resolveTheme(): Theme {
  return readStoredTheme() ?? systemTheme();
}

function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;

  // index.html carries one theme-color meta per colour scheme. With no choice
  // each keeps its own colour; an explicit choice pins both.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const schemeIsDark = (meta.getAttribute("media") ?? "").includes("dark");
    meta.setAttribute("content", THEME_COLORS[theme ?? (schemeIsDark ? "dark" : "light")]);
  }
}

/**
 * Runs a theme change with a brief colour cross-fade, unless the visitor
 * prefers reduced motion. The class comes off again straight away so ordinary
 * interactions are never slowed by a global transition.
 */
function withThemeTransition(change: () => void): void {
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    change();
    return;
  }
  const root = document.documentElement;
  root.classList.add("theme-transition");
  change();
  window.setTimeout(() => root.classList.remove("theme-transition"), 320);
}

/** Stores and applies an explicit choice. */
export function chooseTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Unavailable storage: the theme still applies for this visit.
  }
  withThemeTransition(() => applyTheme(theme));
}

/**
 * The resolved theme and a toggle between Light and Dark.
 *
 * While no choice is stored it tracks the OS live, so the toggle icon never
 * disagrees with what is on screen.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(resolveTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      if (!readStoredTheme()) setTheme(query.matches ? "dark" : "light");
    };
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      chooseTheme(next);
      return next;
    });
  }, []);

  return [theme, toggle];
}
