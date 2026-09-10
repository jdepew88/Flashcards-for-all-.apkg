/**
 * Guards on the things that make this deployable and usable on a phone, which
 * are easy to break without any test noticing.
 *
 * Note the limits: jsdom performs no layout, so the responsive checks here
 * verify the class/markup contract the layout depends on, not pixel results.
 * `wrangler deploy --dry-run` is what actually validates the Cloudflare config
 * end to end; this file catches the config regressions cheaply and first.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import { UploadScreen } from "@/components/upload-screen";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const root = process.cwd();
const read = (p: string) => readFile(resolve(root, p), "utf8");

const deck: FlashcardDeck = {
  slug: "upload-cfg",
  title: "Config Deck",
  cardCount: 1,
  chapters: [{ id: "Only", name: "Only", cardCount: 1 }],
  cards: [{ id: 1, chapter: "Only", tags: [], front: "<p>F</p>", back: "<p>B</p>" }],
};

describe("wrangler configuration", () => {
  it("exists as wrangler.toml at the repository root", async () => {
    await expect(read("wrangler.toml")).resolves.toBeTruthy();
  });

  it("declares a worker name, a compatibility date and the built asset directory", async () => {
    const toml = await read("wrangler.toml");

    expect(toml).toMatch(/^name\s*=\s*"[a-z0-9-]+"/m);
    expect(toml).toMatch(/^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"/m);
    expect(toml).toContain("[assets]");
    expect(toml).toMatch(/directory\s*=\s*"\.\/dist"/);
  });

  it("serves unmatched paths as the SPA shell so deep links resolve", async () => {
    const toml = await read("wrangler.toml");

    expect(toml).toMatch(/not_found_handling\s*=\s*"single-page-application"/);
  });

  it("contains no secrets, bindings or credentials", async () => {
    const toml = await read("wrangler.toml");

    expect(toml).not.toMatch(/\[\[?(kv_namespaces|d1_databases|r2_buckets|secrets)/);
    expect(toml).not.toMatch(/(account_id|api_token|password|secret_key)\s*=/i);
  });

  it("matches the asset directory Vite actually builds into", async () => {
    const viteConfig = await read("vite.config.ts");

    expect(viteConfig).toMatch(/outDir:\s*"dist"/);
  });
});

describe("package scripts", () => {
  it("provides the documented commands", async () => {
    const pkg = JSON.parse(await read("package.json"));

    for (const script of ["dev", "build", "lint", "typecheck", "test", "deploy"]) {
      expect(pkg.scripts[script], `missing script: ${script}`).toBeTruthy();
    }
    expect(pkg.scripts.deploy).toContain("wrangler deploy");
  });
});

describe("responsive contract", () => {
  it("declares a mobile viewport and opts into the safe area", async () => {
    const html = await read("index.html");

    expect(html).toMatch(/name="viewport"[^>]*width=device-width/);
    expect(html).toMatch(/name="viewport"[^>]*initial-scale=1/);
    expect(html).toMatch(/viewport-fit=cover/);
  });

  it("keeps the study column width-capped with small-screen padding", () => {
    const { container } = render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const shell = container.firstElementChild!;

    expect(shell.className).toContain("max-w-2xl");
    expect(shell.className).toContain("w-full");
    // Tight gutters on a phone, roomier from the `sm` breakpoint up.
    expect(shell.className).toMatch(/\bpx-3\b/);
    expect(shell.className).toMatch(/\bsm:px-6\b/);
  });

  it("gives the navigation row flexible buttons and thumb-sized targets", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const next = screen.getByRole("button", { name: /next/i });

    // h-11 is 44px — the usual minimum comfortable touch target.
    expect(next.className).toContain("h-11");
    expect(next.className).toContain("flex-1");
    expect(next.parentElement!.className).toContain("flex");
  });

  it("lets long card content scroll instead of overflowing the card", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    for (const face of document.querySelectorAll(".anki-card-content")) {
      expect(face.className).toContain("overflow-y-auto");
    }
  });

  it("keeps the chapter select from pushing the toolbar wider than the screen", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const select = screen.getByLabelText("Filter by chapter");

    expect(select.className).toContain("min-w-0");
    expect(select.className).toContain("truncate");
  });

  it("wraps the landing page's action row rather than overflowing it", () => {
    render(<UploadScreen onStudy={vi.fn()} />);
    const sampleButton = screen.getByRole("button", { name: /try a sample deck/i });

    expect(sampleButton.parentElement!.className).toContain("flex-wrap");
  });
});

describe("stylesheet", () => {
  it("normalises Anki card HTML the same way the CCNA build does", async () => {
    const css = await read("src/styles.css");

    for (const rule of [
      ".anki-card-content img",
      ".anki-card-content .cloze-blank",
      ".anki-card-content .cloze-reveal",
      ".anki-card-content audio.anki-audio",
    ]) {
      expect(css).toContain(rule);
    }
    // Deck-supplied images must never blow out the card on a narrow screen.
    expect(css).toMatch(/\.anki-card-content img\s*\{[^}]*max-width:\s*100%/);
  });
});

describe("no phone-home", () => {
  it("ships no analytics, tracking or upload endpoint in application source", async () => {
    const { globSync } = await import("node:fs");
    const files = globSync("src/**/*.{ts,tsx}", { cwd: root });
    expect(files.length).toBeGreaterThan(5);

    for (const relative of files) {
      const source = await read(relative);
      expect(source, `${relative} must not call an external endpoint`).not.toMatch(
        /https?:\/\/(?!localhost)/
      );
      // Matched against code shapes rather than the bare words, so a comment
      // explaining that the CCNA analytics tracker was removed does not trip it.
      expect(source, `${relative} must not include analytics`).not.toMatch(
        /\bgtag\s*\(|googletagmanager|posthog\.|mixpanel\.|@sentry\/|navigator\.sendBeacon/i
      );
      expect(source, `${relative} must not POST anything`).not.toMatch(
        /method:\s*["']POST["']/i
      );
    }
  });
});
