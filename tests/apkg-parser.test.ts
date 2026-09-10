/**
 * Parser / file-format compatibility.
 *
 * These tests run the extracted `parseApkgFile` — the same code CCNA Practice
 * Labs runs — against the real .apkg in public/sample-deck.apkg and against
 * deliberately broken files. If any of this drifts, decks that work on CCNA
 * Practice Labs stop working here, which is the one thing this project must
 * not do.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ApkgParseError, parseApkgFile } from "@/lib/flashcards/client-import";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const WASM_PATH = resolve(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm");
const SAMPLE_PATH = resolve(process.cwd(), "public/sample-deck.apkg");

async function fileFromDisk(path: string, name: string): Promise<File> {
  return toFile(await readFile(path), name);
}

/**
 * Wraps bytes as a File. The re-wrap in a fresh Uint8Array is not busywork:
 * Node's Buffer and JSZip's output are typed over ArrayBufferLike, which the
 * File constructor does not accept.
 */
function toFile(bytes: Uint8Array | Buffer, name: string): File {
  return new File([new Uint8Array(bytes)], name);
}

function parse(file: File, onProgress?: (message: string) => void) {
  return parseApkgFile(file, onProgress, { wasmUrl: WASM_PATH });
}

/** Structural check against the FlashcardDeck contract copied from CCNA Practice Labs. */
function assertDeckShape(deck: FlashcardDeck) {
  expect(typeof deck.slug).toBe("string");
  expect(typeof deck.title).toBe("string");
  expect(typeof deck.cardCount).toBe("number");
  expect(Array.isArray(deck.chapters)).toBe(true);
  expect(Array.isArray(deck.cards)).toBe(true);
  expect(deck.cardCount).toBe(deck.cards.length);

  for (const chapter of deck.chapters) {
    expect(Object.keys(chapter).sort()).toEqual(["cardCount", "id", "name"]);
    expect(typeof chapter.id).toBe("string");
    expect(typeof chapter.name).toBe("string");
    expect(typeof chapter.cardCount).toBe("number");
  }

  for (const card of deck.cards) {
    expect(Object.keys(card).sort()).toEqual(["back", "chapter", "front", "id", "tags"]);
    expect(typeof card.id).toBe("number");
    expect(typeof card.chapter).toBe("string");
    expect(typeof card.front).toBe("string");
    expect(typeof card.back).toBe("string");
    expect(Array.isArray(card.tags)).toBe(true);
    expect(card.tags.every((t) => typeof t === "string")).toBe(true);
  }
}

describe("parseApkgFile — a known-valid deck", () => {
  it("parses the sample .apkg and produces the CCNA FlashcardDeck shape", async () => {
    const { deck } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));

    assertDeckShape(deck);
    expect(deck.cards).toHaveLength(6);
    expect(deck.title).toBe("sample-deck");
    expect(deck.slug).toMatch(/^upload-/);
  });

  it("matches the schema of the CCNA deck JSON exactly (same keys, same types)", async () => {
    // The keys asserted here are read off the real
    // src/data/flashcards/ccna-200-301-by-chapter.json in ccna-10-week-dev,
    // which is what the CCNA viewer consumes. A parser whose output has these
    // keys is a parser the CCNA viewer would accept, and vice versa.
    const { deck } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));

    expect(Object.keys(deck).sort()).toEqual(["cardCount", "cards", "chapters", "slug", "title"]);
    expect(Object.keys(deck.cards[0]).sort()).toEqual(["back", "chapter", "front", "id", "tags"]);
    expect(Object.keys(deck.chapters[0]).sort()).toEqual(["cardCount", "id", "name"]);
  });

  it("derives chapters from Anki subdeck names and counts them", async () => {
    const { deck } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));
    const chapters = Object.fromEntries(deck.chapters.map((c) => [c.name, c.cardCount]));

    expect(chapters).toEqual({
      "Chapter 1 - Networking Basics": 4,
      "Chapter 2 - Cloze Practice": 1,
      "Chapter 3 - Diagrams": 1,
    });
    // Chapter id and name are the same string, as in the CCNA deck JSON.
    expect(deck.chapters.every((c) => c.id === c.name)).toBe(true);
  });

  it("renders fronts and backs through the note's own Anki template", async () => {
    const { deck } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));
    const osi = deck.cards.find((c) => c.front.includes("OSI</b> stand for"));

    expect(osi).toBeDefined();
    expect(osi!.back).toContain("Open Systems Interconnection");
    // {{FrontSide}} on the answer template pulls the rendered question through.
    expect(osi!.back).toContain("OSI</b> stand for");
  });

  it("expands a reversed note into two cards, one per template ordinal", async () => {
    const { deck } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));
    const forward = deck.cards.find((c) => c.front.trim() === "DNS");
    const reverse = deck.cards.find((c) => c.front.trim() === "Domain Name System");

    expect(forward?.back).toContain("Domain Name System");
    expect(reverse?.back).toContain("DNS");
  });

  it("renders a cloze note blanked on the front and revealed on the back", async () => {
    const { deck } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));
    const cloze = deck.cards.find((c) => c.chapter === "Chapter 2 - Cloze Practice");

    expect(cloze).toBeDefined();
    expect(cloze!.front).toContain('class="cloze-blank"');
    expect(cloze!.front).not.toContain("MAC address");
    expect(cloze!.back).toContain('class="cloze-reveal"');
    expect(cloze!.back).toContain("MAC address");
    // The {{#Extra}} conditional fires because Extra is non-empty.
    expect(cloze!.back).toContain("Learned from the source address");
  });

  it("carries note tags across", async () => {
    const { deck } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));
    const tagged = deck.cards.find((c) => c.front.includes("OSI</b> stand for"));

    expect(tagged!.tags).toEqual(["sample", "networking"]);
  });

  it("extracts bundled media referenced by a card", async () => {
    const { deck, media } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));
    const withImage = deck.cards.find((c) => c.chapter === "Chapter 3 - Diagrams");

    expect(withImage!.front).toContain('src="diagram.png"');
    expect(media.has("diagram.png")).toBe(true);
    expect((await media.get("diagram.png")!.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("bundles a diagram that is a well-formed, visible PNG", async () => {
    // An earlier sample shipped a PNG whose IDAT would not inflate. Browsers
    // still report its declared size, so it "loaded" — and painted nothing.
    const { media } = await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"));
    const png = Buffer.from(await media.get("diagram.png")!.arrayBuffer());

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks: { type: string; data: Buffer }[] = [];
    for (let at = 8; at < png.length; ) {
      const length = png.readUInt32BE(at);
      chunks.push({ type: png.toString("ascii", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) });
      at += 12 + length;
    }
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);

    const ihdr = chunks[0].data;
    const [width, height] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4)];
    expect([ihdr[8], ihdr[9]]).toEqual([8, 6]); // 8-bit RGBA
    const pixels = inflateSync(chunks[1].data);
    const stride = 1 + width * 4;
    expect(pixels.length).toBe(height * stride);

    let opaque = 0;
    for (let y = 0; y < height; y++) {
      expect(pixels[y * stride]).toBe(0); // filter type None, so the row is raw RGBA
      for (let x = 0; x < width; x++) if (pixels[y * stride + 4 + x * 4] === 255) opaque++;
    }
    expect(opaque).toBeGreaterThan(0);
  });

  it("reports progress while parsing", async () => {
    const messages: string[] = [];
    await parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg"), (m) => messages.push(m));

    expect(messages).toContain("Unzipping deck…");
    expect(messages).toContain("Reading card database…");
    expect(messages).toContain("Rendering cards…");
  });

  it("gives each upload a unique slug so two files never collide", async () => {
    const [a, b] = await Promise.all([
      parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg")),
      parse(await fileFromDisk(SAMPLE_PATH, "sample-deck.apkg")),
    ]);

    expect(a.deck.slug).not.toBe(b.deck.slug);
  });
});

describe("parseApkgFile — rejections", () => {
  it("rejects a file that is not named .apkg", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "deck.zip");

    await expect(parse(file)).rejects.toThrow(ApkgParseError);
    await expect(parse(file)).rejects.toThrow(/choose a \.apkg file/i);
  });

  it("rejects an empty file", async () => {
    const file = new File([], "empty.apkg");

    await expect(parse(file)).rejects.toThrow();
  });

  it("rejects a .apkg that is not a zip archive at all", async () => {
    const file = new File([new TextEncoder().encode("not a zip, just text")], "bogus.apkg");

    await expect(parse(file)).rejects.toThrow();
  });

  it("rejects a zip with no Anki collection inside", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "nothing to see here");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(parse(toFile(bytes, "no-collection.apkg"))).rejects.toThrow(
      /doesn't look like a valid Anki \.apkg file/i
    );
  });

  it("explains how to re-export a newer compressed .apkg", async () => {
    const zip = new JSZip();
    zip.file("collection.anki21b", new Uint8Array([0, 1, 2]));
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(parse(toFile(bytes, "modern.apkg"))).rejects.toThrow(
      /Support older Anki versions/
    );
  });

  it("rejects a collection with no readable cards", async () => {
    // A structurally valid collection whose `cards` table is empty.
    const sample = await readFile(SAMPLE_PATH);
    const source = await JSZip.loadAsync(sample);
    const dbBytes = await source.file("collection.anki21")!.async("uint8array");

    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const db = new SQL.Database(dbBytes);
    db.run("DELETE FROM cards");
    const emptied = db.export();
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki21", emptied);
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(parse(toFile(bytes, "cardless.apkg"))).rejects.toThrow(
      /No readable cards were found/i
    );
  });

  it("rejects a collection whose col table is empty", async () => {
    const sample = await readFile(SAMPLE_PATH);
    const source = await JSZip.loadAsync(sample);
    const dbBytes = await source.file("collection.anki21")!.async("uint8array");

    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const db = new SQL.Database(dbBytes);
    db.run("DELETE FROM col");
    const emptied = db.export();
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki21", emptied);
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(parse(toFile(bytes, "no-col.apkg"))).rejects.toThrow(
      /collection table is empty or unreadable/i
    );
  });

  it("skips cards whose note or model is missing rather than failing the whole deck", async () => {
    const sample = await readFile(SAMPLE_PATH);
    const source = await JSZip.loadAsync(sample);
    const dbBytes = await source.file("collection.anki21")!.async("uint8array");

    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const db = new SQL.Database(dbBytes);
    // Orphan one card by deleting the note it points at.
    db.run("DELETE FROM notes WHERE id = 1500000000001");
    const damaged = db.export();
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki21", damaged);
    zip.file("media", await source.file("media")!.async("string"));
    zip.file("0", await source.file("0")!.async("uint8array"));
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const { deck } = await parse(toFile(bytes, "orphaned.apkg"));

    expect(deck.cards).toHaveLength(5);
    assertDeckShape(deck);
  });

  it("rejects a file over the 200MB in-browser limit without reading it", async () => {
    // Only `size` is consulted before the guard trips, so a stub is enough —
    // allocating 200MB in a test process would be gratuitous.
    const oversized = { name: "huge.apkg", size: 201 * 1024 * 1024 } as File;

    await expect(parse(oversized)).rejects.toThrow(/larger than 200MB/i);
  });
});
