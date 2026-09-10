// Builds public/sample-deck.apkg.
//
// The CCNA Practice Labs repository contains no .apkg file to reuse as a
// compatibility fixture — its only flashcard data is the already-parsed deck
// JSON, which is the parser's *output*, not an accepted input. So this script
// writes a real one: a genuine Anki deck package (zip + SQLite collection +
// media map) built to the same structure Anki itself exports, exercising the
// features the parser actually implements — subdecks as chapters, note tags,
// a Basic model, a reversed model with two templates, a cloze model, and a
// bundled image.
//
// The generated file is both the sample deck offered on the landing page and
// the fixture the parser tests load, so anything the tests prove is true of a
// file real users can download.
//
// Run with: npm run fixtures

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import JSZip from "jszip";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = resolve(root, "node_modules/sql.js/dist/sql-wasm.wasm");
const outPath = resolve(root, "public/sample-deck.apkg");

// A 24x24 blue square PNG, so a card in the sample deck carries real media.
const DIAGRAM_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAPElEQVR42u3NMQEAAAgDoJnc6BpjDyQg" +
    "d1XNzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozr4NHhkAAY0d5DoAAAAASUVORK5CYII=",
  "base64"
);

const BASIC_MODEL_ID = 1600000000001;
const REVERSED_MODEL_ID = 1600000000002;
const CLOZE_MODEL_ID = 1600000000003;

const DECK_BASICS = 1700000000001;
const DECK_CLOZE = 1700000000002;
const DECK_MEDIA = 1700000000003;

const models = {
  [BASIC_MODEL_ID]: {
    id: BASIC_MODEL_ID,
    name: "Basic",
    type: 0,
    flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }],
    tmpls: [
      {
        name: "Card 1",
        ord: 0,
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
      },
    ],
  },
  [REVERSED_MODEL_ID]: {
    id: REVERSED_MODEL_ID,
    name: "Basic (and reversed card)",
    type: 0,
    flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }],
    tmpls: [
      {
        name: "Card 1",
        ord: 0,
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
      },
      {
        name: "Card 2",
        ord: 1,
        qfmt: "{{Back}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}",
      },
    ],
  },
  [CLOZE_MODEL_ID]: {
    id: CLOZE_MODEL_ID,
    name: "Cloze",
    type: 1,
    flds: [{ name: "Text", ord: 0 }, { name: "Extra", ord: 1 }],
    tmpls: [
      {
        name: "Cloze",
        ord: 0,
        qfmt: "{{cloze:Text}}",
        afmt: "{{cloze:Text}}{{#Extra}}<br><br>{{Extra}}{{/Extra}}",
      },
    ],
  },
};

const decks = {
  1: { id: 1, name: "Default" },
  [DECK_BASICS]: { id: DECK_BASICS, name: "Sample Deck::Chapter 1 - Networking Basics" },
  [DECK_CLOZE]: { id: DECK_CLOZE, name: "Sample Deck::Chapter 2 - Cloze Practice" },
  [DECK_MEDIA]: { id: DECK_MEDIA, name: "Sample Deck::Chapter 3 - Diagrams" },
};

/** Anki joins a note's field values with the 0x1f separator. */
const SEP = String.fromCharCode(0x1f);

const notes = [
  {
    id: 1500000000001,
    mid: BASIC_MODEL_ID,
    tags: " sample networking ",
    flds: ["What does <b>OSI</b> stand for?", "Open Systems Interconnection"].join(SEP),
  },
  {
    id: 1500000000002,
    mid: BASIC_MODEL_ID,
    tags: " sample networking ",
    flds: ["How many layers does the OSI model have?", "Seven"].join(SEP),
  },
  {
    id: 1500000000003,
    mid: REVERSED_MODEL_ID,
    tags: " sample acronyms ",
    flds: ["DNS", "Domain Name System"].join(SEP),
  },
  {
    id: 1500000000004,
    mid: CLOZE_MODEL_ID,
    tags: " sample cloze ",
    flds: [
      "A switch forwards frames using a {{c1::MAC address}} table.",
      "Learned from the source address of incoming frames.",
    ].join(SEP),
  },
  {
    id: 1500000000005,
    mid: BASIC_MODEL_ID,
    tags: " sample media ",
    flds: [
      'Which topology is shown?<br><img src="diagram.png">',
      'A point-to-point link.<br><img src="diagram.png">',
    ].join(SEP),
  },
];

const cards = [
  { id: 1400000000001, nid: 1500000000001, did: DECK_BASICS, ord: 0 },
  { id: 1400000000002, nid: 1500000000002, did: DECK_BASICS, ord: 0 },
  // The reversed note produces two cards, one per template ordinal.
  { id: 1400000000003, nid: 1500000000003, did: DECK_BASICS, ord: 0 },
  { id: 1400000000004, nid: 1500000000003, did: DECK_BASICS, ord: 1 },
  { id: 1400000000005, nid: 1500000000004, did: DECK_CLOZE, ord: 0 },
  { id: 1400000000006, nid: 1500000000005, did: DECK_MEDIA, ord: 0 },
];

const SQL = await initSqlJs({ locateFile: () => wasmPath });
const db = new SQL.Database();

// Anki's collection schema. Only `models`/`decks` on col, and the columns the
// parser selects from notes/cards, are load-bearing — the rest is here so the
// fixture is shaped like a file Anki would actually produce.
db.run(`
  CREATE TABLE col (
    id integer primary key, crt integer not null, mod integer not null,
    scm integer not null, ver integer not null, dty integer not null,
    usn integer not null, ls integer not null, conf text not null,
    models text not null, decks text not null, dconf text not null, tags text not null
  );
  CREATE TABLE notes (
    id integer primary key, guid text not null, mid integer not null,
    mod integer not null, usn integer not null, tags text not null,
    flds text not null, sfld integer not null, csum integer not null,
    flags integer not null, data text not null
  );
  CREATE TABLE cards (
    id integer primary key, nid integer not null, did integer not null,
    ord integer not null, mod integer not null, usn integer not null,
    type integer not null, queue integer not null, due integer not null,
    ivl integer not null, factor integer not null, reps integer not null,
    lapses integer not null, left integer not null, odue integer not null,
    odid integer not null, flags integer not null, data text not null
  );
`);

const now = 1735689600; // 2025-01-01T00:00:00Z — fixed so the file is reproducible.

db.run(
  `INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`,
  [now, now * 1000, now * 1000, JSON.stringify(models), JSON.stringify(decks)]
);

for (const note of notes) {
  db.run(
    `INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, 0, 0, '')`,
    [
      note.id,
      `guid-${note.id}`,
      note.mid,
      now,
      note.tags,
      note.flds,
      note.flds.split(SEP)[0].replace(/<[^>]+>/g, ""),
    ]
  );
}

for (const card of cards) {
  db.run(
    `INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, 1, 0, 2500, 0, 0, 0, 0, 0, 0, '')`,
    [card.id, card.nid, card.did, card.ord, now]
  );
}

const dbBytes = db.export();
db.close();

const zip = new JSZip();
// Modern Anki exports name the database collection.anki21; the parser prefers
// that entry and falls back to collection.anki2.
zip.file("collection.anki21", dbBytes);
zip.file("media", JSON.stringify({ 0: "diagram.png" }));
zip.file("0", DIAGRAM_PNG);

const apkg = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, apkg);

console.log(
  `[make-sample-apkg] wrote ${outPath} (${apkg.length} bytes, ${cards.length} cards, 3 chapters)`
);
