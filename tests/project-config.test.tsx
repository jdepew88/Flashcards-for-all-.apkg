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
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("security headers", () => {
  it("ships a _headers file in the published assets", async () => {
    await expect(read("public/_headers")).resolves.toContain("Content-Security-Policy");
  });

  it("locks the default source to this origin", async () => {
    const headers = await read("public/_headers");

    expect(headers).toMatch(/Content-Security-Policy:.*default-src 'self'/);
  });

  it("allows WebAssembly without allowing eval", async () => {
    const headers = await read("public/_headers");
    const csp = headers.match(/Content-Security-Policy:([^\n]*)/)![1];

    // sql.js instantiates a WASM module; it does not call eval or new Function.
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toMatch(/'unsafe-eval'/);
  });

  it("permits only local media sources, so a card cannot reach the network", async () => {
    const csp = (await read("public/_headers")).match(/Content-Security-Policy:([^\n]*)/)![1];

    expect(csp).toContain("img-src 'self' blob: data:");
    expect(csp).toContain("media-src 'self' blob: data:");
    expect(csp).toContain("connect-src 'self'");
    // No wildcard host anywhere in the policy.
    expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it("allows scripts from this origin only — no inline script, no external host", async () => {
    const csp = (await read("public/_headers")).match(/Content-Security-Policy:([^\n]*)/)![1];

    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("blocks plugins, framing and base-tag hijacking", async () => {
    const csp = (await read("public/_headers")).match(/Content-Security-Policy:([^\n]*)/)![1];

    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'none'");
  });

  it("sets the supporting security headers", async () => {
    const headers = await read("public/_headers");

    expect(headers).toMatch(/X-Content-Type-Options:\s*nosniff/);
    expect(headers).toMatch(/Referrer-Policy:\s*no-referrer/);
    expect(headers).toMatch(/X-Frame-Options:\s*DENY/);
    expect(headers).toMatch(/Permissions-Policy:.*camera=\(\)/);
    expect(headers).toMatch(/Permissions-Policy:.*microphone=\(\)/);
    expect(headers).toMatch(/Permissions-Policy:.*geolocation=\(\)/);
    expect(headers).toMatch(/Cross-Origin-Opener-Policy:\s*same-origin/);
    expect(headers).toMatch(/Cross-Origin-Resource-Policy:\s*same-origin/);
    expect(headers).toMatch(/Strict-Transport-Security:\s*max-age=\d+/);
  });

  it("documents the one CSP concession it makes", async () => {
    const headers = await read("public/_headers");

    // style-src 'unsafe-inline' is required by React inline styles and
    // framer-motion's animated transforms; the file has to say why.
    expect(headers).toContain("style-src 'self' 'unsafe-inline'");
    expect(headers).toMatch(/framer-motion/);
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

  it("keeps the study screen one viewport tall, with safe-area gutters", async () => {
    const { container } = render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const css = await read("src/styles.css");
    const shell = css.match(/\.study-shell\s*\{([^}]*)\}/)![1];

    expect(container.firstElementChild!.className).toContain("study-shell");
    expect(shell).toMatch(/height:\s*100dvh/);
    expect(shell).toMatch(/env\(safe-area-inset-left\)/);
    expect(shell).toMatch(/env\(safe-area-inset-right\)/);
    expect(css).toMatch(/\.safe-top\s*\{[^}]*env\(safe-area-inset-top\)/);
    expect(css).toMatch(/\.safe-bottom\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  });

  it("caps the card's width so lines stay readable on wide screens", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const stage = screen.getByTestId("card-surface").parentElement!;

    expect(stage.className).toContain("w-full");
    expect(stage.className).toContain("max-w-[40rem]");
  });

  it("gives the study controls thumb-sized targets", () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const buttons = within(screen.getByTestId("control-bar")).getAllByRole("button");

    expect(buttons).toHaveLength(3);
    // h-12 is 48px — comfortably above the usual 44px minimum.
    for (const button of buttons) expect(button.className).toMatch(/\bh-12\b/);
  });

  it("lets long card content scroll inside the card instead of growing the layout", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const css = await read("src/styles.css");

    for (const face of document.querySelectorAll(".anki-card-content")) {
      expect(face.parentElement!.className).toContain("card-scroll");
      expect(face.parentElement!.className).toContain("min-h-0");
    }
    expect(css).toMatch(/\.card-scroll\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("keeps the chapter select from pushing the options panel wider than the screen", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Study options" }));
    const select = await screen.findByLabelText("Filter by chapter");

    expect(select.className).toContain("w-full");
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

  it("honours reduced motion", async () => {
    const css = await read("src/styles.css");

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
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

  it("loads no external stylesheet, font, script or image", async () => {
    // Everything the page itself references, outside src/**/*.ts(x).
    const files = ["index.html", "src/styles.css", "public/theme-init.js", "public/favicon.svg"];

    for (const relative of files) {
      const source = (await read(relative))
        // An SVG's XML namespace is an identifier, not a request.
        .replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
      expect(source, `${relative} must not reference another origin`).not.toMatch(/https?:\/\//);
      expect(source, `${relative} must not reference a protocol-relative URL`).not.toMatch(
        /["'(]\/\/[a-z0-9]/i
      );
    }

    const css = await read("src/styles.css");
    expect(css).not.toMatch(/@font-face/);
    // The only import is Tailwind itself, resolved and bundled at build time.
    expect([...css.matchAll(/@import\s+([^;]+);/g)].map((m) => m[1].trim())).toEqual([
      '"tailwindcss"',
    ]);
  });
});
