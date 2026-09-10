// Extracted from CCNA Practice Labs (ccna-10-week-dev) — src/lib/flashcards/client-import.ts
// at commit 2a66e957007a9465e5e06042ad8e450b419dd42f.
//
// Adapted for the standalone build in exactly two ways:
//   1. The Next.js "use client" directive is dropped (Vite has no such concept).
//   2. The sql.js wasm URL is injectable instead of hard-coded to
//      "/sql-wasm.wasm", so Node-based tests can point at node_modules. The
//      default is the same "/sql-wasm.wasm" the CCNA app uses.
//   3. Rendered card HTML passes through sanitizeCardHtml() before it is
//      stored. A .apkg is untrusted input, and the regex pass in
//      anki-template.ts is a first line, not a boundary. See sanitize.ts.
// Parsing behavior is otherwise unchanged.

import type { Flashcard, FlashcardChapter, FlashcardDeck } from "./types";
import {
  collectMediaFilenames,
  convertSoundTags,
  externalizeLinks,
  renderCard,
  sanitizeHtml,
  type AnkiTemplate,
} from "./anki-template";
import { sanitizeCardHtml } from "./sanitize";

export interface ParsedApkg {
  deck: FlashcardDeck;
  media: Map<string, Blob>;
}

interface AnkiModelField {
  name: string;
}

interface AnkiModel {
  flds: AnkiModelField[];
  tmpls: AnkiTemplate[];
}

interface AnkiDeckMeta {
  name: string;
}

const MAX_APKG_SIZE = 200 * 1024 * 1024; // 200MB guardrail for in-browser parsing

export class ApkgParseError extends Error {}

function slugFromFile(fileName: string): string {
  const base = fileName.replace(/\.apkg$/i, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `upload-${Date.now().toString(36)}-${random}-${base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)}`;
}

export interface ParseApkgOptions {
  /** Where to fetch sql.js's WebAssembly binary from. Defaults to "/sql-wasm.wasm". */
  wasmUrl?: string;
}

export async function parseApkgFile(
  file: File,
  onProgress?: (message: string) => void,
  options?: ParseApkgOptions
): Promise<ParsedApkg> {
  if (!file.name.toLowerCase().endsWith(".apkg")) {
    throw new ApkgParseError("Please choose a .apkg file exported from Anki.");
  }
  if (file.size > MAX_APKG_SIZE) {
    throw new ApkgParseError("That file is larger than 200MB — too big to parse in the browser.");
  }

  onProgress?.("Unzipping deck…");
  const [{ default: JSZip }, sqlModule] = await Promise.all([
    import("jszip"),
    import("sql.js"),
  ]);

  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const dbEntryName = zip.file("collection.anki21") ? "collection.anki21" : "collection.anki2";
  const dbEntry = zip.file(dbEntryName);
  if (!dbEntry) {
    if (zip.file("collection.anki21b")) {
      throw new ApkgParseError(
        "This deck uses Anki's newer compressed format. In Anki, re-export it with \"Support older Anki versions\" checked and try again."
      );
    }
    throw new ApkgParseError("This doesn't look like a valid Anki .apkg file.");
  }

  onProgress?.("Reading card database…");
  const dbBuffer = await dbEntry.async("uint8array");
  const initSqlJs = sqlModule.default;
  const wasmUrl = options?.wasmUrl ?? "/sql-wasm.wasm";
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(dbBuffer);

  let media: Map<string, Blob>;
  let deckData: FlashcardDeck;

  try {
    const mediaEntry = zip.file("media");
    const mediaMapRaw: Record<string, string> = mediaEntry
      ? JSON.parse(await mediaEntry.async("string"))
      : {};
    const filenameToZipKey: Record<string, string> = {};
    for (const [zipKey, filename] of Object.entries(mediaMapRaw)) {
      filenameToZipKey[filename] = zipKey;
    }

    const colResult = db.exec("select models, decks from col");
    const colRow = colResult[0]?.values[0];
    if (!colRow) throw new ApkgParseError("This deck's collection table is empty or unreadable.");
    const models: Record<string, AnkiModel> = JSON.parse(String(colRow[0]));
    const decks: Record<string, AnkiDeckMeta> = JSON.parse(String(colRow[1]));

    const noteRows = db.exec("select id, mid, flds, tags from notes");
    const notesById = new Map<number, { mid: number; flds: string; tags: string }>();
    for (const row of noteRows[0]?.values ?? []) {
      const [id, mid, flds, tags] = row;
      notesById.set(Number(id), { mid: Number(mid), flds: String(flds), tags: String(tags ?? "") });
    }

    onProgress?.("Rendering cards…");
    const cardRows = db.exec("select id, nid, did, ord from cards");
    const usedMedia = new Set<string>();
    const chapterCounts = new Map<string, number>();
    const cards: Flashcard[] = [];

    for (const row of cardRows[0]?.values ?? []) {
      const [cardId, nid, did, ord] = row;
      const note = notesById.get(Number(nid));
      if (!note) continue;
      const model = models[String(note.mid)];
      if (!model) continue;
      const template = model.tmpls[Number(ord)];
      if (!template) continue;

      const fieldValues = note.flds.split("\x1f");
      const fields: Record<string, string> = {};
      model.flds.forEach((f, i) => {
        fields[f.name] = fieldValues[i] ?? "";
      });

      const { front, back } = renderCard(template, fields, Number(ord));
      // The allowlist pass runs before media collection, so a source the
      // sanitizer rejects is never looked up in the archive either.
      const frontHtml = sanitizeCardHtml(
        externalizeLinks(sanitizeHtml(convertSoundTags(front))),
        { allowBareMedia: true }
      );
      const backHtml = sanitizeCardHtml(
        externalizeLinks(sanitizeHtml(convertSoundTags(back))),
        { allowBareMedia: true }
      );

      collectMediaFilenames(frontHtml, usedMedia);
      collectMediaFilenames(backHtml, usedMedia);

      const deckMeta = decks[String(did)];
      const chapter = deckMeta ? deckMeta.name.split("::").pop()!.trim() : "General";
      const tags = note.tags.trim().split(/\s+/).filter(Boolean);

      chapterCounts.set(chapter, (chapterCounts.get(chapter) ?? 0) + 1);
      cards.push({ id: Number(cardId), chapter, tags, front: frontHtml, back: backHtml });
    }

    if (cards.length === 0) {
      throw new ApkgParseError("No readable cards were found in that deck.");
    }

    onProgress?.(`Extracting ${usedMedia.size} media files…`);
    media = new Map();
    for (const filename of usedMedia) {
      const zipKey = filenameToZipKey[filename];
      if (zipKey === undefined) continue;
      const entry = zip.file(zipKey);
      if (!entry) continue;
      const blob = await entry.async("blob");
      media.set(filename, blob);
    }

    const chapters: FlashcardChapter[] = Array.from(chapterCounts.entries())
      .map(([name, cardCount]) => ({ id: name, name, cardCount }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    deckData = {
      slug: slugFromFile(file.name),
      title: file.name.replace(/\.apkg$/i, ""),
      cardCount: cards.length,
      chapters,
      cards,
    };
  } finally {
    db.close();
  }

  return { deck: deckData, media };
}
