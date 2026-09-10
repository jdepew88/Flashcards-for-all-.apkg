# Flashcard file format

This document describes the file format the Flashcard Study Tool accepts, as
implemented by `src/lib/flashcards/client-import.ts` and
`src/lib/flashcards/anki-template.ts`. It is written from the parser, not from
what the UI happens to show.

The same parser runs in the CCNA Practice Labs flashcard tool. A file that works
in one works unchanged in the other.

---

## 1. The accepted file

| Property | Value |
| --- | --- |
| Extension | `.apkg` (case-insensitive) |
| What it is | An **Anki deck package** — a ZIP archive containing a SQLite database and, optionally, media files |
| File picker filter | `accept=".apkg"` |
| MIME type | Not checked. The extension is the only gate, so a correct file with an unusual reported type is still accepted |
| Encoding | Binary. There is no text encoding to get right — the archive carries its own |
| Size limit | 200 MB. Larger files are rejected before any parsing (`"That file is larger than 200MB — too big to parse in the browser."`) |
| Card limit | None |

There is no JSON, CSV, TXT or Markdown input format. `.apkg` is the only one.

### Producing a file

In Anki: **File → Export → Anki Deck Package (.apkg)**.

If the export dialog offers **"Support older Anki versions"**, tick it. Anki's
newest export writes the collection as `collection.anki21b`, compressed with
Zstandard, which cannot be read in the browser. Such a file is rejected with a
message saying exactly this.

---

## 2. Structure of the archive

The parser reads these entries from the ZIP:

| Entry | Required | Purpose |
| --- | --- | --- |
| `collection.anki21` | One of the two | The SQLite collection database. Preferred when present |
| `collection.anki2` | One of the two | The older name for the same database. Used when `collection.anki21` is absent |
| `media` | Optional | A JSON object mapping archive entry names to original filenames, e.g. `{"0":"diagram.png","1":"clip.mp3"}` |
| `0`, `1`, `2`, … | Optional | The media files themselves, named by the keys in `media` |

Anything else in the archive is ignored.

If neither collection entry is present, the file is rejected:
`"This doesn't look like a valid Anki .apkg file."`

---

## 3. Required database contents

Three tables are read. Only the listed columns matter; a real Anki export has
many more, and extra columns are ignored.

### `col` — exactly one row is read

| Column | Type | Required | Contents |
| --- | --- | --- | --- |
| `models` | TEXT | **Yes** | JSON object keyed by model (note type) id |
| `decks` | TEXT | **Yes** | JSON object keyed by deck id |

An empty `col` table is rejected:
`"This deck's collection table is empty or unreadable."`

**Each model** must provide:

| Field | Type | Required | Contents |
| --- | --- | --- | --- |
| `flds` | array | **Yes** | Field definitions in order. Only `name` is read |
| `tmpls` | array | **Yes** | Card templates in order. Each needs `qfmt` (question format) and `afmt` (answer format) |

**Each deck** must provide:

| Field | Type | Required | Contents |
| --- | --- | --- | --- |
| `name` | string | **Yes** | The deck name. `::` separates subdecks |

### `notes` — one row per note

| Column | Type | Required | Contents |
| --- | --- | --- | --- |
| `id` | INTEGER | **Yes** | Note id, referenced by `cards.nid` |
| `mid` | INTEGER | **Yes** | Model id, a key into `col.models` |
| `flds` | TEXT | **Yes** | Field values joined by the `0x1f` unit separator, in the model's field order |
| `tags` | TEXT | Optional | Space-separated tags. Empty or NULL is fine |

### `cards` — one row per card

| Column | Type | Required | Contents |
| --- | --- | --- | --- |
| `id` | INTEGER | **Yes** | Becomes the card's `id` in the app, and the key for "known" marks |
| `nid` | INTEGER | **Yes** | The note this card renders |
| `did` | INTEGER | **Yes** | The deck this card belongs to, a key into `col.decks` |
| `ord` | INTEGER | **Yes** | Template ordinal — which of the model's `tmpls` renders this card |

A card is **silently skipped** (rather than failing the import) when its note is
missing, its model is missing, or `tmpls[ord]` does not exist. If every card is
skipped, or the table is empty, the file is rejected:
`"No readable cards were found in that deck."`

> **Note on cloze decks.** A card is rendered with `model.tmpls[ord]`. Cloze
> models have a single template, so cloze cards with `ord > 0` — the second and
> later deletions in a note — find no template and are skipped. This is the
> behavior of the CCNA Practice Labs parser and is preserved here deliberately:
> changing it would make the two tools disagree about what a deck contains.

---

## 4. How a card is built

For each card row:

1. The note's `flds` is split on `0x1f` and zipped with the model's field names.
2. `tmpls[ord].qfmt` is rendered into the **front** and `tmpls[ord].afmt` into
   the **back**, supporting:
   - `{{FieldName}}` — field substitution
   - `{{FrontSide}}` — on the answer, inserts the rendered question
   - `{{#Field}}…{{/Field}}` — include when the field has non-markup content
   - `{{^Field}}…{{/Field}}` — include when it does not
   - `{{cloze:Field}}` — cloze deletions, blanked on the front
     (`<span class="cloze-blank">[…]</span>`) and revealed on the back
     (`<span class="cloze-reveal">…</span>`). `{{c1::text::hint}}` shows the
     hint in the blank
   - Any other `{{filter:Field}}` renders as empty; leftover `{{…}}` is stripped
3. `[sound:file.mp3]` becomes `<audio controls class="anki-audio" src="file.mp3">`.
4. The HTML is sanitized twice. First the pass inherited from CCNA Practice Labs
   removes `<script>` and `<iframe>` elements, inline `on*` handlers and
   `javascript:` URLs. Then the HTML is re-parsed and rebuilt from an allowlist
   (`src/lib/flashcards/sanitize.ts`), which additionally removes `<style>`,
   `<object>`, `<embed>`, `<svg>`, `<base>`, `<meta>`, `<link>` and form
   controls, filters `style` attributes, and blocks remote media. See
   [README § Security](./README.md#security).
5. Absolute `http(s)` links get `target="_blank" rel="noopener noreferrer"`.
6. Bare `src` filenames on `<img>`/`<audio>` are collected, and the matching
   media files are extracted from the archive. Remote `http(s)` media is
   replaced with a `[media blocked]` marker rather than fetched.

Card styling from the model (`css`) is **not** applied — cards are rendered with
this app's own typography, which is what makes the reading-options sheet useful.

---

## 5. The parsed result

Parsing produces a `FlashcardDeck` (`src/lib/flashcards/types.ts`) — the same
shape the CCNA Practice Labs viewer consumes:

```ts
interface FlashcardDeck {
  slug: string;                 // generated: "upload-<time>-<random>-<filename>"
  title: string;                // the filename without ".apkg"
  cardCount: number;            // always equal to cards.length
  chapters: FlashcardChapter[]; // sorted by name, numeric-aware
  cards: Flashcard[];
}

interface FlashcardChapter {
  id: string;        // same string as `name`
  name: string;      // last "::" segment of the Anki deck name
  cardCount: number; // cards in this chapter
}

interface Flashcard {
  id: number;      // the Anki card id
  chapter: string; // matches a FlashcardChapter.name
  tags: string[];  // the note's tags, split on whitespace
  front: string;   // rendered, sanitized HTML
  back: string;    // rendered, sanitized HTML
}
```

Concretely, from the bundled sample deck:

```json
{
  "slug": "upload-mgk2p4-a1b2c3-sample-deck",
  "title": "sample-deck",
  "cardCount": 6,
  "chapters": [
    { "id": "Chapter 1 - Networking Basics", "name": "Chapter 1 - Networking Basics", "cardCount": 4 },
    { "id": "Chapter 2 - Cloze Practice", "name": "Chapter 2 - Cloze Practice", "cardCount": 1 },
    { "id": "Chapter 3 - Diagrams", "name": "Chapter 3 - Diagrams", "cardCount": 1 }
  ],
  "cards": [
    {
      "id": 1400000000001,
      "chapter": "Chapter 1 - Networking Basics",
      "tags": ["sample", "networking"],
      "front": "What does <b>OSI</b> stand for?",
      "back": "What does <b>OSI</b> stand for?\n\n<hr id=answer>\n\nOpen Systems Interconnection"
    }
  ]
}
```

Every value above is produced by the parser, not invented for the example — the
tests in `tests/apkg-parser.test.ts` assert this shape against the real file at
`public/sample-deck.apkg`.

### Chapters, topics and tags

- **Chapters** come from Anki subdeck names and are the only filter in the UI.
  A deck named `Sample Deck::Chapter 2 - Cloze Practice` yields the chapter
  `Chapter 2 - Cloze Practice`. A deck with no `::` uses its whole name. A card
  whose deck id is not in `col.decks` falls back to `General`.
- **Tags** are parsed and carried on every card, but nothing in the UI filters
  by them today. They survive a round trip; they are not a control surface.
- There is no separate "topic" concept — subdecks are the grouping.

### Multiple decks in one file

One `.apkg` becomes exactly one `FlashcardDeck`. Anki subdecks become chapters
within it rather than separate decks. To keep decks apart, upload separate
`.apkg` files; each is stored under its own slug and appears separately in
"Decks on this device".

---

## 6. Building a compatible file by hand

You do not need Anki, but you do need to produce a real SQLite collection.
`scripts/make-sample-apkg.mjs` is a complete, working, ~200-line example: it
creates the schema, inserts a Basic model, a reversed model and a cloze model,
writes notes and cards, adds a media file, and zips the result. Run it with
`npm run fixtures` and adapt from there.

---

## 7. Limits and rejections at a glance

| Situation | Result |
| --- | --- |
| Filename does not end in `.apkg` | Rejected: "Please choose a .apkg file exported from Anki." |
| Larger than 200 MB | Rejected: "That file is larger than 200MB…" |
| Not a ZIP archive | Rejected with a generic read error |
| ZIP without `collection.anki2`/`.anki21` | Rejected: "This doesn't look like a valid Anki .apkg file." |
| ZIP containing `collection.anki21b` | Rejected with instructions to re-export for older Anki versions |
| Empty `col` table | Rejected: "This deck's collection table is empty or unreadable." |
| No renderable cards | Rejected: "No readable cards were found in that deck." |
| Individual card with a missing note/model/template | Skipped; the rest of the deck imports |
| Media file referenced but not in the archive | Shown as a `[media missing]` marker; the card still imports |
| Media referenced by an `http(s)` URL | Shown as a `[media blocked]` marker; never fetched |
| `<script>`, `<style>`, `<svg>`, `<object>`, `<embed>`, `<iframe>`, `<form>` | Removed with their contents |
| Inline `on*` handlers, `javascript:` URLs | Removed / rewritten to `#` |
| Model `css` styling | Ignored |
| Scheduling data, review history, deck options | Ignored — this is a study viewer, not a scheduler |
