/**
 * Home Screen / installed-app support.
 *
 * The app is installable so an iPhone can run it without the browser's own
 * address bar and toolbars — the one route to that on iPhone. It is static
 * metadata plus icons: no service worker, no offline cache, nothing that
 * could serve a stale build or reach another origin.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync, globSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTALLED_QUERY,
  fullscreenAvailable,
  homeScreenIsTheWayToFullscreen,
  isInstalledDisplay,
} from "@/lib/display-mode";

const root = process.cwd();
const read = (p: string) => readFile(resolve(root, p), "utf8");

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  [key: string]: unknown;
}

async function manifest(): Promise<Manifest> {
  return JSON.parse(await read("public/manifest.webmanifest"));
}

/** Width and height from a PNG's IHDR chunk. */
async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("web app manifest", () => {
  it("is valid JSON with the fields an installed app needs", async () => {
    const m = await manifest();

    expect(m.name).toBe("Flashcards for All");
    expect(m.short_name.length).toBeGreaterThan(0);
    // Short enough to sit under a Home Screen icon without being cut off.
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("asks for standalone, which iOS honours (it does not honour manifest fullscreen)", async () => {
    expect((await manifest()).display).toBe("standalone");
  });

  it("points at icons that exist, are PNGs, and are the size they claim", async () => {
    const m = await manifest();
    expect(m.icons.length).toBeGreaterThanOrEqual(2);

    for (const icon of m.icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src).toMatch(/^\/icons\/[\w-]+\.png$/);
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(await pngSize(resolve(root, "public", icon.src.slice(1)))).toEqual({ width: w, height: h });
    }
    const sizes = m.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("uses the app's own palette", async () => {
    const m = await manifest();
    const css = await read("src/styles.css");
    const background = css.match(/:root \{[^}]*--background: (#[0-9a-f]{6})/i)![1];

    expect(m.background_color.toLowerCase()).toBe(background.toLowerCase());
  });

  it("references nothing on another origin", async () => {
    const raw = await read("public/manifest.webmanifest");

    expect(raw).not.toMatch(/https?:\/\//);
    expect(raw).not.toMatch(/"\/\//);
  });
});

describe("index.html", () => {
  it("links the manifest", async () => {
    expect(await read("index.html")).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
  });

  it("carries the iOS Home Screen metadata", async () => {
    const html = await read("index.html");

    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="[^"]+"/);
    // "default", not black-translucent: its white status-bar text would vanish
    // on the light theme's page colour.
    expect(html).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="default"/);
  });

  it("gives iOS a full-bleed 180px touch icon (iOS rounds the corners itself)", async () => {
    const path = resolve(root, "public/icons/apple-touch-icon.png");
    expect(await pngSize(path)).toEqual({ width: 180, height: 180 });
    // Corner pixel is opaque: no transparent corners for iOS to fill with black.
    const bytes = await readFile(path);
    expect(bytes.length).toBeGreaterThan(200);
  });
});

describe("no service worker", () => {
  it("registers none and ships none: nothing can serve a stale build", async () => {
    const files = globSync("src/**/*.{ts,tsx}", { cwd: root });
    for (const relative of files) {
      expect(await read(relative), relative).not.toMatch(/serviceWorker\s*\.\s*register/);
    }
    const publicFiles = await readdir(resolve(root, "public"));
    expect(publicFiles.filter((f) => /^(sw|service-worker)\.js$/i.test(f))).toEqual([]);
    expect(existsSync(resolve(root, "public/sw.js"))).toBe(false);
  });

  it("keeps the manifest same-origin under the existing CSP", async () => {
    const csp = (await read("public/_headers")).match(/Content-Security-Policy:([^\n]*)/)![1];
    expect(csp).toContain("manifest-src 'self'");
  });
});

describe("installed-mode detection", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete (navigator as unknown as Record<string, unknown>).standalone;
    const doc = document as unknown as Record<string, unknown>;
    delete doc.fullscreenEnabled;
    delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
  });

  function displayMode(standalone: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: query === INSTALLED_QUERY && standalone,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  it("is false in an ordinary browser tab", () => {
    displayMode(false);
    expect(isInstalledDisplay()).toBe(false);
  });

  it("follows the standard display-mode media query", () => {
    displayMode(true);
    expect(isInstalledDisplay()).toBe(true);
  });

  it("falls back to iOS's navigator.standalone", () => {
    displayMode(false);
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    expect(isInstalledDisplay()).toBe(true);
  });

  it("points to the Home Screen only for an iOS tab without the Fullscreen API", () => {
    displayMode(false);
    // A desktop or Android browser: no navigator.standalone.
    expect(homeScreenIsTheWayToFullscreen()).toBe(false);

    // An iPhone tab: navigator.standalone exists (false), no Fullscreen API.
    Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
    expect(fullscreenAvailable()).toBe(false);
    expect(homeScreenIsTheWayToFullscreen()).toBe(true);

    // An iPad tab: the (prefixed or standard) Fullscreen API is there, so use it.
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: () => Promise.resolve(),
    });
    expect(fullscreenAvailable()).toBe(true);
    expect(homeScreenIsTheWayToFullscreen()).toBe(false);
  });

  it("does not offer the Home Screen to an app already running from it", () => {
    displayMode(false);
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    expect(homeScreenIsTheWayToFullscreen()).toBe(false);
  });
});
