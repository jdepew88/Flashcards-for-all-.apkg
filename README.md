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

## Privacy

**Your flashcard file is processed locally in your browser and is not uploaded
to a server.** This is a statement about the implementation, not a policy:

- The site is static assets only. There is no API route, no server-side code, no
  database and nothing to upload to.
- `.apkg` files are unzipped and read in the browser, using JSZip and a
  WebAssembly build of SQLite (`sql.js`).
- Parsed decks and their media are stored in **IndexedDB** on the visitor's own
  device, so a deck is still there on the next visit. The delete button on the
  landing page removes one.
- Reading preferences and "known" marks live in **localStorage**, on the device.
- There is no analytics, no tracking, no account, no cloud storage and no
  third-party request — not even a web font. `tests/project-config.test.tsx`
  asserts that no source file calls an external URL.

Because everything is per-device, a deck uploaded on your laptop is not on your
phone, and a link to a study session only works in the browser that has the deck.

---

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

87 tests across six files:

| File | Covers |
| --- | --- |
| `tests/apkg-parser.test.ts` | The real `.apkg` parses; output matches the CCNA deck schema exactly; chapters, tags, cloze, reversed notes and media; every rejection path (wrong extension, empty file, non-zip, no collection, `anki21b`, empty `col`, no cards, oversized) and the skip-don't-fail behavior for damaged cards |
| `tests/anki-template.test.ts` | The template renderer, pinned to CCNA Practice Labs' behavior: field substitution, conditionals, cloze blanking and reveal, `{{FrontSide}}`, HTML sanitization, link externalization, media collection and rewriting |
| `tests/flashcard-viewer.test.tsx` | Rendering, reveal/flip (button, keyboard), previous/next (buttons, arrow keys, bounds), shuffle, restart, chapter filtering, known-marking, hide-known, reset progress, the options sheet, and exiting |
| `tests/end-to-end.test.tsx` | The full chain — real file → parser → viewer — plus loading one deck, leaving it, and loading another |
| `tests/upload-screen.test.tsx` | Landing copy, the privacy statement, valid upload via picker and via drag-and-drop, the on-device deck list, and every error path a visitor can hit |
| `tests/project-config.test.tsx` | Wrangler config validity, package scripts, the responsive class contract, the Anki stylesheet, and the no-phone-home guarantee |

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
│   │   ├── upload-screen.tsx      Landing page: explain, upload, deck list
│   │   ├── study-screen.tsx       Loads a stored deck, resolves its media
│   │   ├── flashcard-viewer.tsx   The study interface  [extracted]
│   │   ├── flashcard-options-sheet.tsx  Font / size / reset / exit  [extracted]
│   │   └── ui/primitives.tsx      Badge, Button, Card
│   └── lib/
│       ├── flashcards/
│       │   ├── types.ts               FlashcardDeck contract  [verbatim]
│       │   ├── anki-template.ts       Anki template renderer  [verbatim]
│       │   ├── client-import.ts       .apkg parser  [extracted]
│       │   ├── resolve-deck-media.ts  Media → blob: URLs  [extracted]
│       │   └── uploaded-decks.ts      IndexedDB deck storage  [extracted]
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
  syncs. Clearing site data removes them.
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
