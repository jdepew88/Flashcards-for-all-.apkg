/**
 * The architectural guarantee: deck data never leaves the browser, and there is
 * no server-side storage for it to leave to.
 *
 * Two kinds of check here.
 *
 * 1. Static analysis of every application source file. This is the one that
 *    catches a future change — someone adding an upload endpoint would have to
 *    delete a test that says, in words, that uploads do not exist.
 * 2. A live check that importing a deck end to end makes no network call other
 *    than the one static asset the parser needs.
 */

import { readFile } from "node:fs/promises";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseApkgFile } from "@/lib/flashcards/client-import";
import {
  deleteAllUploadedDecks,
  listUploadedDecks,
  saveUploadedDeck,
} from "@/lib/flashcards/uploaded-decks";

const root = process.cwd();
const read = (p: string) => readFile(resolve(root, p), "utf8");
const WASM_PATH = resolve(root, "node_modules/sql.js/dist/sql-wasm.wasm");
const SAMPLE_PATH = resolve(root, "public/sample-deck.apkg");

const sourceFiles = globSync("src/**/*.{ts,tsx}", { cwd: root });

/** Removes block and line comments so scans see code, not documentation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

beforeEach(async () => {
  await deleteAllUploadedDecks();
});

afterEach(async () => {
  await deleteAllUploadedDecks();
  vi.restoreAllMocks();
});

describe("no upload path exists in the source", () => {
  it("finds application source to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  it("never sends a request body", async () => {
    for (const relative of sourceFiles) {
      const source = await read(relative);

      expect(source, `${relative} must not POST/PUT/PATCH`).not.toMatch(
        /method:\s*["'`](POST|PUT|PATCH)["'`]/i
      );
      expect(source, `${relative} must not build a request body`).not.toMatch(
        /\bbody:\s*(formData|blob|file|deck|buffer)/i
      );
      expect(source, `${relative} must not use FormData`).not.toMatch(/new FormData\b/);
      expect(source, `${relative} must not use XMLHttpRequest`).not.toMatch(
        /new XMLHttpRequest\b/
      );
      expect(source, `${relative} must not use sendBeacon`).not.toMatch(/sendBeacon/);
      expect(source, `${relative} must not open a socket`).not.toMatch(
        /new WebSocket\b|new EventSource\b/
      );
    }
  });

  it("references no server, cloud or storage-service API", async () => {
    for (const relative of sourceFiles) {
      const source = await read(relative);

      // Cloudflare storage products and generic backend shapes. Deck
      // persistence is the browser's job; none of these may appear.
      expect(source, `${relative} must not reference Cloudflare storage`).not.toMatch(
        /\bR2Bucket\b|\bKVNamespace\b|\bD1Database\b|\bDurableObject\b|env\.(R2|KV|DB|BUCKET)\b/
      );
      expect(source, `${relative} must not call an api route`).not.toMatch(
        /["'`]\/api\/|supabase|firebase|amazonaws|blob\.core\.windows\.net/i
      );
    }
  });

  it("makes only same-origin requests, to two known static assets", async () => {
    const fetchTargets: string[] = [];

    for (const relative of sourceFiles) {
      const source = await read(relative);
      // Comments are prose, not calls — several of them discuss the one fetch
      // this app makes, and counting those would defeat the check.
      for (const match of stripComments(source).matchAll(/fetch\(\s*([^)]*)\)/g)) {
        fetchTargets.push(`${relative}: ${match[1].trim()}`);
      }
      expect(source, `${relative} must not reference an absolute URL`).not.toMatch(
        /["'`]https?:\/\/(?!localhost)/
      );
    }

    // One fetch in the app: the sample deck. sql.js fetches its own wasm from
    // the URL we hand it, which is likewise same-origin.
    expect(fetchTargets).toHaveLength(1);
    expect(fetchTargets[0]).toContain("SAMPLE_DECK_URL");
    expect(await read("src/components/upload-screen.tsx")).toContain(
      'const SAMPLE_DECK_URL = "/sample-deck.apkg"'
    );
    expect(await read("src/lib/flashcards/client-import.ts")).toContain(
      'options?.wasmUrl ?? "/sql-wasm.wasm"'
    );
  });
});

describe("no server-side deck storage exists", () => {
  it("ships no server code at all", () => {
    // A Worker script, an API handler or a functions directory would each be a
    // place a deck could be sent. There are none: wrangler.toml serves assets.
    expect(globSync("functions/**/*", { cwd: root })).toHaveLength(0);
    expect(globSync("api/**/*", { cwd: root })).toHaveLength(0);
    expect(globSync("src/**/*.server.{ts,tsx}", { cwd: root })).toHaveLength(0);
    expect(globSync("worker/**/*", { cwd: root })).toHaveLength(0);
  });

  it("declares no Cloudflare storage bindings and no Worker entry point", async () => {
    const toml = await read("wrangler.toml");

    expect(toml).not.toMatch(/\[\[(kv_namespaces|d1_databases|r2_buckets|queues|hyperdrive)/);
    expect(toml).not.toMatch(/\[\[?durable_objects/);
    expect(toml).not.toMatch(/^main\s*=/m);
    // Only static assets.
    expect(toml).toMatch(/\[assets\]/);
  });

  it("depends on no server, database or cloud-storage package", async () => {
    const pkg = JSON.parse(await read("package.json"));
    const deps = Object.keys(pkg.dependencies ?? {});

    expect(deps).not.toContain("@prisma/client");
    for (const dep of deps) {
      expect(dep, `unexpected server-side dependency: ${dep}`).not.toMatch(
        /^(express|fastify|hono|prisma|mysql|pg|mongodb|@aws-sdk|@supabase|firebase)/
      );
    }
    // What it does depend on is entirely browser-side.
    expect(deps.sort()).toEqual([
      "framer-motion",
      "idb-keyval",
      "jszip",
      "lucide-react",
      "react",
      "react-dom",
      "sql.js",
      "zustand",
    ]);
  });
});

describe("importing a deck end to end makes no unexpected request", () => {
  it("parses and persists a real .apkg without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const bytes = await readFile(SAMPLE_PATH);
    const file = new File([new Uint8Array(bytes)], "sample-deck.apkg");

    // The whole import path: read -> parse -> persist. sql.js is pointed at a
    // filesystem path here, standing in for the same-origin /sql-wasm.wasm.
    const { deck, media } = await parseApkgFile(file, undefined, { wasmUrl: WASM_PATH });
    await saveUploadedDeck({ deck, media, source: file });

    expect(await listUploadedDecks()).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the deck's bytes out of every argument passed to fetch", async () => {
    // Belt and braces: even if some future code did call fetch during an
    // import, this asserts a deck never rides along in the call.
    const calls: unknown[][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    const bytes = await readFile(SAMPLE_PATH);
    const file = new File([new Uint8Array(bytes)], "sample-deck.apkg");
    const { deck, media } = await parseApkgFile(file, undefined, { wasmUrl: WASM_PATH });
    await saveUploadedDeck({ deck, media, source: file });

    expect(calls).toHaveLength(0);
  });
});
