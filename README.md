# Flashcard Study Tool

A standalone web app for studying Anki flashcard decks in the browser. Upload a
`.apkg` file, and study it — flip, shuffle, filter by chapter, and mark what you
already know.

**It is completely independent from CCNA Practice Labs.** No login, no account,
no subscription, no course, no database, no backend. It is a static site: HTML,
CSS and JavaScript, served from Cloudflare's edge and running entirely in the
visitor's browser.

---

## Where it came from

The flashcard tool on [CCNA Practice Labs](https://ccnapracticelabs.com) already
does this well, but only for people signed in to that site. This project lifts
that tool out and makes it something you can hand to anyone.

The parser, the Anki template renderer, the card viewer and the on-device deck
storage are **extracted from the CCNA Practice Labs codebase**, not rewritten.
Everything specific to that product — authentication, tool-access gating,
navigation, learning analytics, the built-in CCNA deck, the design system — was
left behind.

**A flashcard file that works in the CCNA Practice Labs flashcard tool works
here, unchanged.** That is the project's first requirement, and
`tests/apkg-parser.test.ts` and `tests/end-to-end.test.tsx` exist to keep it
true.

---

## Supported flashcard format

One file type: an **Anki deck package** (`.apkg`), exported from Anki with
**File → Export → Anki Deck Package**.

- Up to 200 MB
- Both `collection.anki21` and the older `collection.anki2` layouts are read
- Basic, reversed and cloze notes all render, each through its own Anki template
- Anki subdecks (`Deck::Chapter 3 - Routing`) become the chapter filter
- Note tags are carried through
- Bundled images and audio are extracted and shown on the card
- If Anki's export dialog offers **"Support older Anki versions"**, tick it —
  the newest compressed export (`collection.anki21b`) cannot be read in a browser

A sample deck ships with the app (`public/sample-deck.apkg`) and is offered on
the landing page, so you can see the whole flow without uploading anything.

**[FLASHCARD-FORMAT.md](./FLASHCARD-FORMAT.md) documents the format in full** —
every required table and column, every optional field, every rejection message,
and a worked example of the parsed output. Read that before making a deck by
hand.

### The parsed deck shape

Whatever the input file looks like, parsing produces this — the same structure
the CCNA Practice Labs viewer consumes:

```ts
interface FlashcardDeck {
  slug: string;                 // "upload-<time>-<random>-<filename>"
  title: string;                // filename without ".apkg"
  cardCount: number;
  chapters: { id: string; name: string; cardCount: number }[];
  cards: {
    id: number;      // the Anki card id
    chapter: string; // matches a chapter name
    tags: string[];
    front: string;   // rendered, sanitized HTML
    back: string;    // rendered, sanitized HTML
  }[];
}
```

---

## Architecture: where everything actually happens

```
Cloudflare
    |  serves the static application only
    v
Your browser
    |
    +-- selects a .apkg from your computer
    +-- reads it locally          (File API)
    +-- parses it locally         (JSZip + sql.js WebAssembly)
    +-- sanitizes card content    (allowlist HTML sanitizer)
    +-- saves the deck locally    (IndexedDB)
    +-- studies locally
    +-- deletes it locally
```

The website is hosted remotely; the *application code* downloads to the browser
and does all the work there. Cloudflare serves HTML, CSS, JS, a WebAssembly
binary and a sample deck — and never receives a deck of yours.

### Your flashcards stay on this device

- **`.apkg` files are never uploaded.** They are opened with the browser's File
  API, unzipped by JSZip, and read by a WebAssembly build of SQLite (`sql.js`),
  all in the tab. There is no API route, no Worker script, no database and
  nothing to upload to — `wrangler.toml` declares static assets and no bindings.
- **Decks are saved in browser-local storage (IndexedDB)**, so you can close the
  tab and come back to them. This is persistent structured storage, not an HTTP
  cache.
- **This service does not store people's flashcards.** There is no server-side
  deck storage of any kind — no D1, R2, KV, Durable Object or database.
- **Local decks can be deleted**, individually or all at once, from the landing
  page. Deletion is local and exhaustive.
- **Clearing this site's browser data removes locally saved decks.** So can the
  browser itself, if the device runs very low on space and persistent storage
  was not granted. Keep your original `.apkg` files.
- **Decks do not synchronize between devices, browsers or profiles.** A deck
  imported on your laptop is not on your phone. There is no account and no sync.
- **No analytics, no tracking, no third-party requests** — not even a web font.

Two test files exist to keep this honest rather than aspirational:
`tests/no-upload.test.ts` scans every source file for request bodies, FormData,
`sendBeacon`, sockets, cloud-storage bindings and API routes, and asserts that
a full import makes no `fetch` call at all; `tests/project-config.test.tsx`
asserts the shipped Content-Security-Policy.

### What is stored, and where

| Where | Key | Contents |
| --- | --- | --- |
| IndexedDB `flashcard-study-tool` / `uploads` | `meta-list` | The deck library: title, card and chapter counts, import time, original filename and size |
| | `deck:<slug>` | Parsed, sanitized cards |
| | `media:<slug>` | Images and audio extracted from the `.apkg` |
| | `source:<slug>` | The original `.apkg`, byte for byte |
| localStorage | `flashcards-known-v1` | Which cards you have marked as known |
| localStorage | `flashcard-prefs-v1` | Reading font and text size |

Binary data is written as raw bytes plus a MIME type rather than as `Blob`
objects, and rebuilt into Blobs on read — ArrayBuffers are structured-cloneable
everywhere, while Blob support in IndexedDB has been uneven across engines.

**Why keep the original `.apkg` as well as the parsed deck?** It roughly doubles
what a deck costs, since the parsed cards are the decompressed form of the same
content. It buys "Download original .apkg" — so a deck imported here is not lost
if you misplace your copy — and the ability to re-parse an old deck with a newer
parser without asking for the file again. Decks whose source exceeds 75 MB skip
it (`MAX_RETAINED_SOURCE_BYTES`); at that size the parsed deck is what matters.

### Persistent storage

After a successful import the app calls `navigator.storage.persist()`. By
default an origin's IndexedDB data is "best-effort" and the browser may evict it
under storage pressure without asking; persistence exempts the origin from that.

The request is entirely advisory. Browsers grant it on their own engagement
heuristics, several never prompt, and some do not implement it. **The app behaves
identically whether it is granted, denied or unsupported** — the only difference
is which sentence the storage section shows the user. It is never presented as a
guarantee, because it is not one: clearing site data still removes everything.

### Deleting

**Delete one deck** asks for confirmation, then removes that deck's parsed cards,
extracted media, original `.apkg`, library entry and study progress. Nothing is
orphaned, and other decks are untouched. The original file on your computer is
not affected — importing only ever reads it.

**Delete all locally saved decks** does the same for every deck at once, behind
its own confirmation. It enumerates and deletes only the keys this application
wrote (`deck:`, `media:`, `source:`) rather than clearing the object store, so
unrelated site data is never involved, and leaves `meta-list` as an empty
library.

The app also prunes orphaned records on load — deck data with no library entry,
which an import interrupted at the wrong moment could leave behind, and which
the user would otherwise have no way to delete.

---

## Security

An imported `.apkg` is content written by whoever made the deck and handed to
someone who only meant to study it. It is treated as untrusted input throughout.

**The `.apkg` is never parsed on the server**, because there is no server — a
malicious deck reaches only the browser of the person who chose to open it. That
does not remove client-side risk, so:

- **Card HTML is rebuilt from an allowlist** (`src/lib/flashcards/sanitize.ts`),
  parsed with `DOMParser` rather than filtered with regexes. `<script>`,
  `<style>`, `<iframe>`, `<object>`, `<embed>`, `<svg>`, `<base>`, `<meta>`,
  `<link>` and form controls are removed with their contents. Unrecognised
  elements are unwrapped, keeping their text.
- **Every `on*` attribute is dropped**, whatever its casing or spacing.
- **`javascript:`, `vbscript:` and `data:` hrefs are neutralised to `#`**,
  including forms obfuscated with embedded tabs, newlines or NUL bytes.
- **`style` attributes are filtered** for `url()`, `expression()`, `behavior`,
  `-moz-binding` and `@import`; ordinary colour and font declarations survive.
- **Sanitization runs twice** — at import, before anything is stored, and again
  at render, so a deck saved by an older version is still cleaned by today's
  rules.
- Ordinary Anki formatting is deliberately preserved: tables, lists, code
  blocks, cloze markup, `[sound:]` audio, `class`/`dir`/`lang`/`title`.

`tests/sanitize.test.ts` covers this from both sides — 33 tests that try to get
script, handlers, plugin content and network requests through, and that check
real Anki formatting still renders.

### External requests from cards

**Imported cards cannot make network requests.** Remote `http(s)` media is
stripped at import and replaced with a small `[media blocked]` marker, so a deck
cannot use an `<img>` to phone home or track when you studied. Only media the
deck actually bundled is shown, resolved to `blob:` URLs from IndexedDB.

Links to external sites are kept — following one is a deliberate user action —
but they are forced to `target="_blank" rel="noopener noreferrer"`.

The Content-Security-Policy enforces the same rule independently: `img-src` and
`media-src` allow only `'self' blob: data:`, and `connect-src` only `'self'`. If
the sanitizer ever missed a case, the browser would still refuse the request.

### Content-Security-Policy

Shipped in `public/_headers`, which Vite copies into `dist/` and Cloudflare
applies to every response (the file itself is not served):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:;
media-src 'self' blob: data:; font-src 'self'; connect-src 'self';
worker-src 'self' blob:; manifest-src 'self'; object-src 'none';
frame-src 'none'; child-src 'none'; frame-ancestors 'none';
base-uri 'self'; form-action 'none'; upgrade-insecure-requests
```

Alongside it: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY`, a `Permissions-Policy` denying camera, microphone,
geolocation and the rest, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy` and `Strict-Transport-Security`.

**Two directives need justifying:**

- **`'wasm-unsafe-eval'`** lets sql.js instantiate the SQLite WebAssembly module
  that reads a deck's collection database. It permits WebAssembly compilation
  and nothing else — **`'unsafe-eval'` is deliberately not granted**. sql.js was
  checked for `eval` and `new Function` and contains neither; it calls
  `WebAssembly.instantiate` only.
- **`style-src 'unsafe-inline'`** is the one real concession. React writes inline
  `style` attributes throughout the viewer (font family and size from the
  reading-options sheet) and framer-motion sets `element.style.transform` every
  frame to animate the card flip. Both are style *attributes* with values that
  change at runtime, so neither a hash nor a nonce can express them. The
  sanitizer compensates: imported cards cannot carry `<style>` elements at all,
  and their `style` attributes are filtered, so this concession is not reachable
  from deck content.

No wildcard hosts appear anywhere in the policy, and no external script source is
permitted.

## Local setup

Requires Node.js 20 or newer.

```powershell
git clone <your-repo-url> flashcard-deployment
cd flashcard-deployment
npm install
```

`npm install` runs a `postinstall` step that copies `sql-wasm.wasm` out of
`node_modules/sql.js` into `public/`, where the parser fetches it at runtime.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload, on http://localhost:5173 |
| `npm run build` | Typecheck, then build the production site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | ESLint over `src/`, `tests/` and the config files |
| `npm run typecheck` | `tsc` with no emit |
| `npm test` | Run the full Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run fixtures` | Regenerate `public/sample-deck.apkg` |
| `npm run deploy` | Build, then deploy to Cloudflare with Wrangler |
| `npm run cf:dev` | Build, then serve through Wrangler's local Workers runtime |

---

## Testing

```powershell
npm test
```

163 tests across nine files:

| File | Covers |
| --- | --- |
| `tests/apkg-parser.test.ts` | The real `.apkg` parses; output matches the CCNA deck schema exactly; chapters, tags, cloze, reversed notes and media; every rejection path (wrong extension, empty file, non-zip, no collection, `anki21b`, empty `col`, no cards, oversized) and the skip-don't-fail behavior for damaged cards |
| `tests/anki-template.test.ts` | The template renderer, pinned to CCNA Practice Labs' behavior: field substitution, conditionals, cloze blanking and reveal, `{{FrontSide}}`, HTML sanitization, link externalization, media collection and rewriting |
| `tests/flashcard-viewer.test.tsx` | Rendering, reveal/flip (button, keyboard), previous/next (buttons, arrow keys, bounds), shuffle, restart, chapter filtering, known-marking, hide-known, reset progress, the options sheet, and exiting |
| `tests/end-to-end.test.tsx` | The full chain — real file → parser → viewer — plus loading one deck, leaving it, and loading another |
| `tests/upload-screen.test.tsx` | Landing copy and privacy statements, import via picker and via drag-and-drop, persistence to real IndexedDB, the deck library for a returning visitor, "download original" built from local bytes, confirmed deletion and delete-all, and every error path a visitor can hit |
| `tests/deck-storage.test.ts` | Browser-local persistence against a real IndexedDB: saving a deck with media and its original file, reopening it without reselecting, exhaustive deletion, delete-all scoped to app-owned keys only, deck isolation, progress removal, and orphan pruning |
| `tests/sanitize.test.ts` | The security boundary: script elements (including ones hidden by malformed markup), SVG/object/embed/iframe/base/meta/form, event handlers, obfuscated `javascript:` URLs, dangerous `style` declarations, blocked remote media — and that ordinary Anki formatting still renders |
| `tests/no-upload.test.ts` | That no upload path exists: source-wide scans for request bodies, FormData, `sendBeacon`, sockets, cloud-storage bindings and API routes; that no server code or storage binding is present; and that a full import makes no `fetch` call |
| `tests/project-config.test.tsx` | Wrangler config validity, the shipped CSP and security headers, package scripts, the responsive class contract, the Anki stylesheet, and the no-phone-home guarantee |

The Cloudflare configuration is additionally validated for real with
`npx wrangler deploy --dry-run`.

**Not covered by automated tests:** real-device touch gestures (swipe to move,
double-tap to flip, swipe up for options) and actual pixel layout — jsdom
performs no layout and synthesises no touch, so the responsive tests assert only
the class contract the layout depends on. The gesture handlers are the CCNA
Practice Labs implementation carried over unchanged, but they have not been
exercised on a physical device in this repository. Worth ten minutes on a phone
before you send the link to anyone.

---

## Production build

```powershell
npm run build
```

Output goes to `dist/`. `jszip` and `sql.js` are dynamically imported, so they
land in separate chunks and are not downloaded until someone actually opens a
file. A first page load is roughly 125 KB gzipped.

---

## Cloudflare deployment

This deploys as a **Worker with static assets** — the modern equivalent of a
Pages site, and the target Cloudflare now recommends for new static projects. It
needs no Worker script at all: `wrangler.toml` points at `dist/` and Cloudflare
serves it.

```powershell
npm run build
npx wrangler deploy
```

or, equivalently, `npm run deploy`.

First time, authenticate with `npx wrangler login`.

### Wrangler configuration

**`wrangler.toml`**, at the repository root:

```toml
name = "flashcard-study-tool"
compatibility_date = "2025-09-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"

[observability]
enabled = true
```

- `name` is the Worker (and default `*.workers.dev` subdomain) name. Change it
  to whatever you want the URL to be.
- `directory` must stay in step with Vite's `build.outDir`.
- `not_found_handling` makes unmatched paths serve `index.html`, so a reloaded
  `#/study/…` link resolves.
- There are **no secrets, bindings, KV namespaces, D1 databases or R2 buckets** —
  the app has no server-side state, and the config file is safe to commit.

Validate the config without deploying:

```powershell
npx wrangler deploy --dry-run
```

To attach a custom domain, add a `routes` entry to `wrangler.toml` or map the
domain to the Worker in the Cloudflare dashboard.

---

## Project structure

```
flashcard-deployment/
├── index.html                     Vite entry document
├── wrangler.toml                  Cloudflare Workers static-assets config
├── vite.config.ts                 Build config (outputs to dist/)
├── vitest.config.ts               Test config (jsdom)
├── eslint.config.js
├── tsconfig*.json
├── FLASHCARD-FORMAT.md            Full file-format reference
├── public/
│   ├── _headers                   CSP + security headers applied by Cloudflare
│   ├── sql-wasm.wasm              SQLite WebAssembly, copied in on install
│   ├── sample-deck.apkg           Generated sample deck, also the test fixture
│   └── favicon.svg
├── scripts/
│   ├── copy-sql-wasm.mjs          postinstall / prebuild copy step
│   └── make-sample-apkg.mjs       Builds the sample .apkg (npm run fixtures)
├── src/
│   ├── main.tsx                   React entry
│   ├── App.tsx                    Two screens, one hash route
│   ├── styles.css                 Theme tokens + Anki card normalisation
│   ├── components/
│   │   ├── upload-screen.tsx      Landing page: import, deck library, privacy
│   │   ├── study-screen.tsx       Loads a stored deck, resolves its media
│   │   ├── flashcard-viewer.tsx   The study interface  [extracted]
│   │   ├── flashcard-options-sheet.tsx  Font / size / reset / exit  [extracted]
│   │   └── ui/
│   │       ├── primitives.tsx     Badge, Button, Card
│   │       └── confirm-dialog.tsx Confirmation for destructive actions
│   └── lib/
│       ├── flashcards/
│       │   ├── types.ts               FlashcardDeck contract  [verbatim]
│       │   ├── anki-template.ts       Anki template renderer  [verbatim]
│       │   ├── client-import.ts       .apkg parser  [extracted]
│       │   ├── sanitize.ts            Allowlist HTML sanitizer
│       │   ├── resolve-deck-media.ts  Media → blob: URLs  [extracted]
│       │   └── uploaded-decks.ts      IndexedDB deck storage  [extracted]
│       ├── storage/persistence.ts     navigator.storage.persist() + quota
│       ├── stores/                    Zustand state  [extracted]
│       ├── fonts.ts                   Reading-options font stacks
│       └── utils.ts
└── tests/
```

`[verbatim]` = copied unchanged from CCNA Practice Labs.
`[extracted]` = copied and adapted; each such file's header comment says exactly
what changed and why.

---

## What was changed on the way out

Anything that would have dragged the CCNA application along with it:

- **Framework.** Next.js 16 (App Router, server components, OpenNext on
  Cloudflare) → **React 19 + Vite 7 + TypeScript**. The flashcard tool was
  already entirely client-side, so nothing needed a server; this build is a
  static bundle instead of a Worker running a Next.js server.
- **Removed:** authentication, `requireToolAccess` gating, course and dashboard
  navigation, ten-week course logic, exam access, the learning-analytics review
  tracker, Prisma/the database, the built-in CCNA deck, CCNA branding.
- **Replaced:** shadcn/Radix primitives with three small local components;
  `next/font` Google fonts with local font stacks (a Google Fonts request would
  have broken the "nothing leaves your browser" claim); the Next.js router with
  a hash route.
- **Added, deliberately small:** explicit Previous / Next / Reveal buttons and a
  Restart control (on the CCNA site the only way forward on a desktop was an
  arrow key, which nobody handed a bare link would guess); a "Reset progress"
  action wired to the store's existing `resetDeck`; a real drag-and-drop target;
  a sample deck; and a key handler that ignores events from form controls, so
  the chapter dropdown keeps its normal keyboard behavior.

The study behavior itself — flip, swipe, double-tap, arrow keys, shuffle,
chapter filter, hide-known, known marks, the reading-options sheet, the progress
bar — is the CCNA implementation, preserved.

---

## Limitations

- **Per-device, per-browser.** Decks live in that browser's IndexedDB. Nothing
  syncs. Clearing site data removes them, and without granted persistent storage
  the browser may evict them under storage pressure.
- **Remote media in cards is blocked.** Anki bundles media inside the `.apkg`, so
  this is rare, but a deck that references images by URL will show
  `[media blocked]` instead. This is deliberate: a remote `<img>` is a tracking
  pixel that reports when you studied.
- **Deck-supplied `<style>` blocks are stripped**, along with `style`
  declarations containing `url()` or `expression()`. Inline colour and font
  styling survives.
- **Storing the original `.apkg` roughly doubles a deck's storage cost.** Decks
  over 75 MB skip it and lose only the "Download original" action.
- **One deck per file.** Anki subdecks become chapters inside a single deck
  rather than separate decks.
- **Cloze cards past the first deletion are skipped.** A cloze note with `c1`
  and `c2` yields one card, because a cloze model has one template and the
  parser renders `tmpls[ord]`. This is CCNA Practice Labs' behavior, kept on
  purpose — changing it would make the two tools disagree about a deck.
- **`collection.anki21b` is not supported.** Anki's newest compressed export
  uses Zstandard; re-export with "Support older Anki versions".
- **Deck styling is ignored.** Anki model CSS is not applied; cards use this
  app's typography, which is what makes the font/size options useful.
- **No scheduling.** This is a viewer, not a spaced-repetition scheduler. Anki
  review history and deck options are read past.
- **No tag filtering.** Tags are parsed and carried on every card, but only
  chapters are exposed as a filter.
- **200 MB ceiling** on the uploaded file, since parsing happens in a tab.
- **`npm audit`** reports a `sharp` advisory reached through
  `wrangler → miniflare`. It is dev-tooling only and never enters the shipped
  bundle; the offered fix downgrades Wrangler by many versions, so it has been
  left alone deliberately.
