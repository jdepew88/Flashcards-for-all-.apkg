/**
 * Light and Dark: the pre-paint bootstrap, the toggle and its memory, and the
 * design tokens both palettes are built from.
 *
 * jsdom cannot paint, so "renders correctly" is checked where it can be
 * checked honestly here: every token has a value in both themes, the explicit
 * and OS-driven dark palettes cannot drift apart, and every pair of colours
 * text is set on meets WCAG AA contrast. The real-browser screenshots do the
 * rest.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_COLORS, THEME_STORAGE_KEY, resolveTheme } from "@/lib/theme";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");
const originalMatchMedia = window.matchMedia;

function setMedia({ dark = false, reduced = false } = {}) {
  window.matchMedia = ((query: string) => ({
    matches:
      (dark && query.includes("prefers-color-scheme: dark")) ||
      (reduced && query.includes("prefers-reduced-motion: reduce")),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

async function runThemeInit() {
  // Evaluated exactly as the browser would run the file from <head>.
  new Function(await read("public/theme-init.js"))();
}

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  delete root.dataset.theme;
  document.head.innerHTML =
    '<meta name="theme-color" content="#f3f2ec" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#101412" media="(prefers-color-scheme: dark)">';
  setMedia();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
  delete root.dataset.theme;
  root.classList.remove("theme-transition");
});

describe("theme bootstrap, before first paint", () => {
  it("reads the same storage key the app writes", async () => {
    expect(await read("public/theme-init.js")).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("applies a stored Dark choice to <html> before the app runs", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    await runThemeInit();
    expect(root.dataset.theme).toBe("dark");
  });

  it("applies a stored Light choice even when the OS prefers dark", async () => {
    setMedia({ dark: true });
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    await runThemeInit();
    expect(root.dataset.theme).toBe("light");
  });

  it("leaves the page to follow the OS when nothing valid is stored", async () => {
    await runThemeInit();
    expect(root.dataset.theme).toBeUndefined();

    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    await runThemeInit();
    expect(root.dataset.theme).toBeUndefined();
  });

  it("survives blocked storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(runThemeInit()).resolves.toBeUndefined();
    expect(root.dataset.theme).toBeUndefined();
  });

  it("is a blocking, same-origin script in <head>, ahead of the app", async () => {
    const html = await read("index.html");
    const head = html.slice(0, html.indexOf("</head>"));
    const tag = head.match(/<script[^>]*src="\/theme-init\.js"[^>]*><\/script>/);

    expect(tag).not.toBeNull();
    // Not deferred, async or a module: those would run after first paint.
    expect(tag![0]).not.toMatch(/\b(defer|async|type="module")\b/);
    expect(html.indexOf("/theme-init.js")).toBeLessThan(html.indexOf("/src/main.tsx"));
    // No inline script anywhere: the CSP (script-src 'self') would block it.
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  });
});

describe("the theme toggle", () => {
  it("starts from the OS preference when no choice is stored", () => {
    setMedia({ dark: true });
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    expect(root.dataset.theme).toBeUndefined();
    expect(resolveTheme()).toBe("dark");
  });

  it("switches Light ↔ Dark and remembers the explicit choice", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(root.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      expect(meta.getAttribute("content")).toBe(THEME_COLORS.dark);
    }

    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(root.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("restores the remembered choice on the next visit", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    expect(resolveTheme()).toBe("dark");
  });

  it("cross-fades the change without leaving a global transition behind", () => {
    vi.useFakeTimers();
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(root.classList.contains("theme-transition")).toBe(true);

    vi.advanceTimersByTime(400);
    expect(root.classList.contains("theme-transition")).toBe(false);
  });

  it("switches instantly for reduced motion", () => {
    setMedia({ reduced: true });
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(root.dataset.theme).toBe("dark");
    expect(root.classList.contains("theme-transition")).toBe(false);
  });
});

// --------------------------------------------------------------- tokens --

function block(css: string, selector: string): { body: string; tokens: Record<string, string> } {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector} block`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("}", open));
  const tokens = Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].replace(/\s+/g, " ").trim()])
  );
  return { body, tokens };
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [text colour, background] pairs that real text in the UI is set on. */
const TEXT_PAIRS: [string, string][] = [
  ["--foreground", "--background"],
  ["--foreground", "--card"],
  ["--foreground", "--card-back"],
  ["--foreground", "--surface-elevated"],
  ["--foreground-muted", "--background"],
  ["--foreground-muted", "--card"],
  ["--foreground-muted", "--surface"],
  ["--foreground-muted", "--surface-elevated"],
  ["--foreground-muted", "--surface-muted"],
  ["--accent", "--background"],
  ["--accent", "--card-back"],
  ["--accent", "--surface-elevated"],
  ["--accent", "--accent-soft"],
  ["--accent-foreground", "--accent"],
  ["--success", "--surface-elevated"],
  ["--danger", "--surface-elevated"],
  ["--danger", "--danger-soft"],
  ["--danger-foreground", "--danger"],
  ["--background", "--foreground"],
  ["--tint-1-fg", "--tint-1-bg"],
  ["--tint-2-fg", "--tint-2-bg"],
  ["--tint-3-fg", "--tint-3-bg"],
  ["--tint-4-fg", "--tint-4-bg"],
  ["--tint-5-fg", "--tint-5-bg"],
];

describe("design tokens", () => {
  it("declare the dark palette identically for an explicit choice and for the OS preference", async () => {
    const css = await read("src/styles.css");
    const explicit = block(css, ':root[data-theme="dark"]');
    const system = block(css, ":root:not([data-theme])");

    expect(system.tokens).toEqual(explicit.tokens);
    expect(explicit.body).toMatch(/color-scheme:\s*dark/);
    expect(system.body).toMatch(/color-scheme:\s*dark/);
  });

  it("give every themed token a value in both Light and Dark", async () => {
    const css = await read("src/styles.css");
    const light = block(css, ":root").tokens;
    const dark = block(css, ':root[data-theme="dark"]').tokens;
    const themeIndependent = ["--gutter", "--ease-out"];

    expect(Object.keys(dark).sort()).toEqual(
      Object.keys(light)
        .filter((name) => !themeIndependent.includes(name))
        .sort()
    );
  });

  it.each(["light", "dark"] as const)("keep text readable in %s mode (WCAG AA, 4.5:1)", async (theme) => {
    const css = await read("src/styles.css");
    const tokens = block(css, theme === "light" ? ":root" : ':root[data-theme="dark"]').tokens;

    for (const [text, background] of TEXT_PAIRS) {
      const ratio = contrast(tokens[text], tokens[background]);
      expect(ratio, `${theme}: ${text} on ${background} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("match the browser-chrome colours to the page background", async () => {
    const css = await read("src/styles.css");
    const html = await read("index.html");

    expect(block(css, ":root").tokens["--background"]).toBe(THEME_COLORS.light);
    expect(block(css, ':root[data-theme="dark"]').tokens["--background"]).toBe(THEME_COLORS.dark);
    expect(html).toContain(`content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)"`);
    expect(html).toContain(`content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)"`);
  });
});
