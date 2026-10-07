// Landing page: the title, the two ways in (the sample deck, or a deck of
// your own), the decks you imported before, and how the thing works.
//
// Laid out as the study desk the rest of the site lives on: the title set as
// flashcards, then translucent panels over the night sky. The "how it works"
// panel carries the one explanatory picture on the site that shows both sides
// of a card at once — the study screen never does.
//
// Derived from CCNA Practice Labs' src/components/flashcards/flashcard-upload.tsx
// (same parser call, same on-device deck list, same error handling), grown
// into the whole landing page: the import, the local deck library with its
// secondary actions behind a ⋯ menu, confirmed deletion, "download original",
// and the storage/privacy disclosures.
//
// Everything on this screen is local. The only network request it can make is
// `fetch("/sample-deck.apkg")` for the bundled sample — a static asset of this
// site, fetched only when the visitor asks for it. No deck data ever leaves.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  EyeOff,
  HardDrive,
  Info,
  Layers,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { buttonClasses } from "@/components/ui/button-styles";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OverflowMenu } from "@/components/ui/menu";
import { Wordmark } from "@/components/ui/logo";
import {
  DoodleArrow,
  DoodleBulb,
  DoodleCap,
  DoodleDash,
  HandNote,
  Ornament,
  Sparkle,
} from "@/components/ui/decor";
import { ThemeToggle } from "@/components/theme-toggle";
import { StudyDirectionControl } from "@/components/study-direction-control";
import { cn } from "@/lib/utils";
import { animateDeckImport, animateHomepageEntrance, finishMotion } from "@/lib/gsap-motion";
import { useInstalledDisplay } from "@/lib/display-mode";
import { ApkgParseError, parseApkgFile } from "@/lib/flashcards/client-import";
import {
  deleteAllUploadedDecks,
  deleteUploadedDeck,
  listUploadedDecks,
  loadDeckSource,
  pruneOrphanedDeckData,
  saveUploadedDeck,
  type UploadedDeckMeta,
} from "@/lib/flashcards/uploaded-decks";
import {
  deleteAllDeckProgress,
  deleteDeckProgress,
  useFlashcardsStore,
} from "@/lib/stores/known-store";
import { useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import {
  formatBytes,
  readPersistenceState,
  readStorageEstimate,
  requestPersistentStorage,
  type PersistenceState,
  type StorageEstimate,
} from "@/lib/storage/persistence";

type Status =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "error"; message: string };

type Pending = { kind: "one"; deck: UploadedDeckMeta } | { kind: "all" } | null;

const SAMPLE_DECK_URL = "/sample-deck.apkg";

// A deck just imported opens straight away, so it first appears in the
// library when the reader comes back: that is when it settles into place, once.
let justImported: string | null = null;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A stable tint (1–5) per deck, so the library is easy to scan by colour too. */
function deckTint(slug: string): number {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 5) + 1;
}

function deckInitial(title: string): string {
  const match = title.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : "#";
}

export function UploadScreen({ onStudy }: { onStudy: (slug: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [decks, setDecks] = useState<UploadedDeckMeta[] | null>(null);
  const installed = useInstalledDisplay();
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [persistence, setPersistence] = useState<PersistenceState>({ status: "unsupported" });
  const [estimate, setEstimate] = useState<StorageEstimate>({});
  const knownByDeck = useFlashcardsStore((s) => s.knownByDeck);
  const pageRef = useRef<HTMLDivElement>(null);
  const libraryRef = useRef<HTMLUListElement>(null);
  // Which side cards open on, chosen before a deck is opened (Study options has it too).
  const studyDirection = useFlashcardPrefsStore((s) => s.studyDirection);
  const setStudyDirection = useFlashcardPrefsStore((s) => s.setStudyDirection);

  const refreshStorageInfo = useCallback(async () => {
    setPersistence(await readPersistenceState());
    setEstimate(await readStorageEstimate());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Sweep up any deck data left behind by an import that died between
      // writing the deck and recording it in the library.
      await pruneOrphanedDeckData().catch(() => 0);
      const list = await listUploadedDecks().catch(() => []);
      if (cancelled) return;
      setDecks(list);
      await refreshStorageInfo();
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshStorageInfo]);

  // The page's first appearance, once per visit (see animateHomepageEntrance).
  // Not cancelled on unmount: it is brief, and StrictMode's rehearsal unmount
  // would otherwise leave it half-played.
  useLayoutEffect(() => {
    animateHomepageEntrance(Array.from(pageRef.current?.querySelectorAll("[data-entrance]") ?? []));
  }, []);

  useEffect(() => {
    if (!justImported || !decks) return;
    const tile = Array.from(libraryRef.current?.querySelectorAll<HTMLElement>("[data-slug]") ?? []).find(
      (el) => el.dataset.slug === justImported
    );
    if (!tile) return;
    justImported = null;
    const motion = animateDeckImport(tile);
    return () => {
      finishMotion(motion);
    };
  }, [decks]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus({ kind: "working", message: "Reading file…" });
    try {
      const { deck, media } = await parseApkgFile(file, (message) =>
        setStatus({ kind: "working", message })
      );
      setStatus({ kind: "working", message: "Saving to this browser…" });
      await saveUploadedDeck({ deck, media, source: file });

      // Asked for here rather than on page load: this is a genuine user action,
      // which is when browsers are most willing to grant it — and a denial
      // changes nothing about what happens next.
      await requestPersistentStorage().then(setPersistence);

      setDecks(await listUploadedDecks());
      await refreshStorageInfo();
      setStatus({ kind: "idle" });
      justImported = deck.slug;
      onStudy(deck.slug);
    } catch (error) {
      const message =
        error instanceof ApkgParseError
          ? error.message
          : "Something went wrong reading that file. Make sure it's an unmodified .apkg export from Anki.";
      setStatus({ kind: "error", message });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleSampleDeck() {
    setStatus({ kind: "working", message: "Fetching the sample deck…" });
    try {
      const response = await fetch(SAMPLE_DECK_URL);
      if (!response.ok) throw new Error(`sample deck request failed: ${response.status}`);
      const blob = await response.blob();
      await handleFile(new File([blob], "sample-deck.apkg", { type: blob.type }));
    } catch {
      setStatus({
        kind: "error",
        message: "Couldn't load the sample deck. Check your connection and try again.",
      });
    }
  }

  async function handleDownloadSource(deck: UploadedDeckMeta) {
    const blob = await loadDeckSource(deck.slug);
    if (!blob) {
      setStatus({
        kind: "error",
        message: "The original file for that deck isn't stored in this browser.",
      });
      return;
    }

    // Built from the Blob already in IndexedDB — no request, no server.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = deck.fileName ?? `${deck.title}.apkg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function confirmDelete() {
    if (!pending) return;

    if (pending.kind === "one") {
      await deleteUploadedDeck(pending.deck.slug);
      deleteDeckProgress(pending.deck.slug);
    } else {
      const removed = await deleteAllUploadedDecks();
      removed.forEach(deleteDeckProgress);
      deleteAllDeckProgress();
    }

    setPending(null);
    setDecks(await listUploadedDecks());
    await refreshStorageInfo();
  }

  const isWorking = status.kind === "working";
  const usage = formatBytes(estimate.usageBytes);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!isWorking) setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    // dragleave also fires when moving onto a child; only a real exit counts.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (isWorking) return;
    handleFile(event.dataTransfer.files?.[0]);
  }

  return (
    // Clipped sideways: the title's fanned cards and stars reach past a phone's edge.
    <div ref={pageRef} className="min-h-dvh overflow-x-clip">
      <div className="page-gutter mx-auto flex min-h-dvh w-full max-w-[58rem] flex-col">
        <header
          className="flex items-center justify-between gap-3 pb-2"
          style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
        >
          <Wordmark />
          <nav aria-label="On this page" className="ml-auto hidden items-center gap-1 text-sm md:flex">
            {[
              ["#get-started", "Get started"],
              ["#how-it-works", "How it works"],
              ["#privacy", "Privacy"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-3.5 py-2 font-medium text-muted transition-colors hover:bg-control hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
          <ThemeToggle className="-mr-2" />
        </header>

        <main className="flex-1 pb-10">
          {/* -------------------------------------------------------- hero -- */}
          <section className="relative pt-8 text-center sm:pt-12">
            <div data-entrance>
              <HeroTitle />
            </div>

            <p data-entrance className="mx-auto mt-9 max-w-3xl font-display text-[1.4rem] leading-snug sm:mt-12 sm:text-[1.8rem]">
              Study smarter with simple, beautiful flashcards.
            </p>
            <p data-entrance className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted sm:text-[17px]">
              Import, study, and remember — all in your browser.
            </p>
          </section>

          {/* ------------------------------------------------------ import -- */}
          <section data-entrance id="get-started" aria-label="Import a deck" className="mt-9 scroll-mt-6 sm:mt-12">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              data-dragging={dragging}
              className={cn(
                "panel relative transition-[border-color,box-shadow] duration-200",
                dragging && "border-accent ring-2 ring-accent/50"
              )}
              style={{ padding: "var(--space-panel)" }}
            >
              <div className="grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
                <div className="min-w-0">
                  <p className="eyebrow">Get started</p>
                  <h2 className="mt-3 font-display text-[1.9rem] font-bold leading-tight sm:text-[2.25rem]">
                    Start studying
                  </h2>
                  <p className="mt-2.5 max-w-md text-[15px] leading-relaxed text-muted sm:text-base">
                    Open the sample deck, or import a compatible Anki deck and study it right here in
                    your browser — flip, move through the deck, and come back to it any time.
                  </p>

                  <div className="mt-6 flex max-w-[22rem] flex-wrap">
                    <button
                      type="button"
                      onClick={handleSampleDeck}
                      disabled={isWorking}
                      className={buttonClasses(
                        "primary",
                        "lg",
                        "group h-14 w-full font-display text-[1.15rem]"
                      )}
                    >
                      Try a sample deck
                      <ArrowRight className="h-5 w-5 transition-transform duration-150 group-hover:translate-x-0.5" />
                    </button>
                  </div>

                  <div className="my-4 flex max-w-[22rem] items-center gap-4 text-sm text-muted" aria-hidden>
                    <span className="h-px flex-1 bg-border-strong/70" />
                    or
                    <span className="h-px flex-1 bg-border-strong/70" />
                  </div>

                  <input
                    id="apkg-upload"
                    ref={inputRef}
                    type="file"
                    accept=".apkg"
                    className="peer sr-only"
                    disabled={isWorking}
                    onChange={(event) => handleFile(event.target.files?.[0])}
                  />
                  <label
                    htmlFor="apkg-upload"
                    className={cn(
                      "btn-glass flex min-h-[4.25rem] max-w-[22rem] select-none items-center gap-4 rounded-2xl px-5 py-3",
                      "transition-[background-color,border-color,transform,opacity] duration-150 active:scale-[0.98]",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
                      isWorking && "pointer-events-none opacity-70"
                    )}
                  >
                    {isWorking ? (
                      <Loader2 className="h-6 w-6 shrink-0 animate-spin text-accent" />
                    ) : (
                      <Upload className="h-6 w-6 shrink-0 text-accent" />
                    )}
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="text-[1.05rem] font-semibold leading-tight">
                        {isWorking ? "Importing…" : "Import .apkg"}
                      </span>
                      <span className="mt-0.5 text-[13px] text-muted">Your own Anki deck, up to 200 MB</span>
                    </span>
                  </label>

                  <p className="mt-3 min-h-5 max-w-[22rem] text-sm text-muted" aria-live="polite">
                    {isWorking ? (
                      status.message
                    ) : dragging ? (
                      <span className="font-medium text-accent">Drop to import</span>
                    ) : (
                      <span className="hidden [@media(hover:hover)]:inline">
                        You can also drop an Anki &ldquo;Deck Package&rdquo; file anywhere on this panel.
                      </span>
                    )}
                  </p>
                </div>

                <PreviewCard />
              </div>

              <p className="mt-6 flex items-center gap-2 border-t border-panel-border pt-4 text-[13px] font-medium text-success">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Processed and saved locally in your browser — never uploaded.
              </p>
            </div>

            <AnimatePresence initial={false}>
              {status.kind === "error" && (
                <motion.div
                  role="alert"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-3 flex items-start gap-2.5 rounded-2xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{status.message}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* ----------------------------------------------------- library -- */}
          {decks && decks.length > 0 && (
            <section className="panel mt-6 p-3 sm:p-5" aria-labelledby="your-decks">
              <div className="flex items-baseline justify-between gap-3 px-2 pt-1 sm:px-1">
                <h2 id="your-decks" className="font-display text-[1.5rem] font-bold leading-tight">
                  Your decks
                </h2>
                <span className="text-xs text-muted">Saved in this browser</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-2 sm:px-1">
                <p className="text-[13px] font-medium text-muted">Study direction</p>
                <StudyDirectionControl small value={studyDirection} onChange={setStudyDirection} />
              </div>

              <ul
                ref={libraryRef}
                aria-label="Saved decks"
                className="mt-3 divide-y divide-panel-border rounded-2xl border border-panel-border bg-background/35"
              >
                {decks.map((deck) => (
                  <DeckRow
                    key={deck.slug}
                    deck={deck}
                    knownCount={knownByDeck[deck.slug]?.length ?? 0}
                    onStudy={() => onStudy(deck.slug)}
                    onDownload={deck.hasSource ? () => handleDownloadSource(deck) : undefined}
                    onDelete={() => setPending({ kind: "one", deck })}
                  />
                ))}
              </ul>

              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setPending({ kind: "all" })}
                  className="min-h-10 rounded-lg px-2 text-xs font-medium text-muted underline-offset-4 transition-colors hover:text-danger hover:underline"
                >
                  Delete all locally saved decks
                </button>
              </div>
            </section>
          )}

          {decks && decks.length === 0 && (
            <section
              aria-label="Your decks"
              className="panel mt-6 flex items-center gap-4 border-dashed px-5 py-5"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Layers className="h-5 w-5" />
              </span>
              <p className="text-sm leading-relaxed text-muted">
                <span className="font-semibold text-foreground">Your decks will appear here.</span>{" "}
                Imported decks stay saved in this browser, so they&apos;re waiting for you next
                time.
              </p>
            </section>
          )}

          {/* ------------------------------------------------ how it works -- */}
          <section
            data-entrance
            className="panel mt-6 scroll-mt-6"
            aria-labelledby="how-it-works"
            style={{ padding: "var(--space-panel)" }}
          >
            <div className="grid gap-8 md:grid-cols-2 md:gap-10">
              <div>
                <p className="eyebrow">How Flashcards for All works</p>
                <h2
                  id="how-it-works"
                  className="mt-3 scroll-mt-6 font-display text-[1.7rem] font-bold leading-tight sm:text-[2rem]"
                >
                  Study with your own decks
                </h2>
                <p className="mt-2.5 text-[15px] leading-relaxed text-muted sm:text-base">
                  Use the sample deck or import an Anki deck of your own. Flip through the cards,
                  check each answer, mark the ones you know, and keep studying at your own pace.
                </p>
              </div>

              <ol className="space-y-5">
                <Step icon={<BookOpen className="h-5 w-5" />} tone={1} title="Open or import">
                  Start with the sample deck, or import your own Anki deck package.
                </Step>
                <Step icon={<RefreshCw className="h-5 w-5" />} tone={3} title="Flip and learn">
                  Read the front, think of the answer, then turn the card over to check it.
                </Step>
                <Step icon={<Check className="h-5 w-5" />} tone={5} title="Mark what you know">
                  Mark cards as known, hide them when you like, and focus on the rest.
                </Step>
              </ol>
            </div>

            <HowItWorksArt />
          </section>

          {/* ----------------------------------------------------- privacy -- */}
          <section className="panel mt-6 overflow-hidden" aria-labelledby="privacy">
            <div style={{ padding: "var(--space-panel)", paddingBottom: 0 }}>
              <p className="eyebrow">Private by design</p>
              <h2
                id="privacy"
                className="mt-3 scroll-mt-6 font-display text-[1.7rem] font-bold leading-tight sm:text-[2rem]"
              >
                Your flashcards stay on this device
              </h2>
            </div>
            <div className="mt-2 grid sm:grid-cols-3">
              <Feature icon={<ShieldCheck className="h-[18px] w-[18px]" />} title="Never uploaded">
                Your <code className="rounded bg-surface-muted px-1 py-0.5 text-[0.85em]">.apkg</code>{" "}
                deck is opened and processed directly in your browser. It is not uploaded to our
                servers.
              </Feature>
              <Feature icon={<HardDrive className="h-[18px] w-[18px]" />} title="Saved in this browser">
                Imported decks are saved locally in this browser so you can return to them later.
                You can delete a saved deck at any time.
              </Feature>
              <Feature icon={<EyeOff className="h-[18px] w-[18px]" />} title="No account, no tracking">
                This site is static files only. There is no account, no analytics, and no server
                that could receive a deck.
              </Feature>
            </div>

            <div
              className="mt-2 border-t border-panel-border bg-background/30"
              style={{ padding: "1.25rem var(--space-panel)" }}
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Info className="h-4 w-4 shrink-0 text-muted" />
                About storage on this device
              </h3>
              <ul className="mt-2.5 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted marker:text-border-strong">
                <li>Saved decks belong to this browser on this device.</li>
                <li>
                  They will not automatically appear on another computer, phone, browser, or
                  browser profile.
                </li>
                <li>Clearing this site&apos;s browser data will remove locally saved decks.</li>
                <li>
                  {installed
                    ? "You opened Flashcards for All from your Home Screen. It may keep its own storage, separate from your browser's, so a deck imported in the browser may need importing again here."
                    : "A copy added to your Home Screen may keep its own separate storage (iPhone and iPad do), so you may need to import your decks again there."}
                </li>
                {persistence.status === "persisted" && (
                  <li>
                    This browser has granted persistent storage, so it will not evict saved decks on
                    its own to reclaim space. It is not a permanent guarantee — clearing site data
                    still removes them.
                  </li>
                )}
                {persistence.status === "best-effort" && (
                  <li>
                    This browser has not granted persistent storage, so it may remove saved decks if
                    the device runs very low on space. Keep your original{" "}
                    <code className="rounded bg-surface-muted px-1 py-0.5 text-[0.85em]">.apkg</code>{" "}
                    files.
                  </li>
                )}
                {usage && <li>This site is currently using about {usage} of browser storage.</li>}
                <li>Importing a deck never changes the original file on your computer — it is only read.</li>
              </ul>
            </div>
          </section>

          {/* ------------------------------------------------------ format -- */}
          <section
            className="panel mt-6"
            aria-labelledby="format"
            style={{ padding: "var(--space-panel)" }}
          >
            <h2 id="format" className="font-display text-[1.4rem] font-bold leading-tight">
              Supported file format
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              One file type: an Anki deck package (
              <code className="rounded bg-surface-muted px-1 py-0.5 text-[0.85em]">.apkg</code>),
              exported from Anki with <em>File → Export → Anki Deck Package</em>. Both the older{" "}
              <code className="rounded bg-surface-muted px-1 py-0.5 text-[0.85em]">collection.anki2</code>{" "}
              and the newer{" "}
              <code className="rounded bg-surface-muted px-1 py-0.5 text-[0.85em]">collection.anki21</code>{" "}
              layouts are read.
            </p>
            <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm leading-relaxed text-muted sm:grid-cols-2">
              <li>Basic, reversed and cloze notes all render through their own card templates.</li>
              <li>Anki subdecks become chapters you can filter by.</li>
              <li>Images and audio bundled in the deck show on the card.</li>
              <li>Scripts, embedded objects and remote media are stripped on import.</li>
              <li className="sm:col-span-2">
                If Anki offers &ldquo;Support older Anki versions&rdquo; on export, tick it — the
                newest compressed format can&apos;t be read in a browser.
              </li>
            </ul>
          </section>
        </main>

        <footer
          className="pb-5"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          <p className="panel flex items-center gap-4 rounded-2xl px-5 py-4 text-sm leading-relaxed text-muted">
            <Lightbulb aria-hidden className="h-6 w-6 shrink-0 text-gold" />
            <span>
              Flashcards for All is a simple, private, in-browser study tool. Your decks stay on
              your device. No account, no cookies, no analytics.
            </span>
          </p>
        </footer>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "one"
            ? `Delete "${pending.deck.title}" from this browser?`
            : "Delete all locally saved decks?"
        }
        confirmLabel={pending?.kind === "one" ? "Delete deck" : "Delete all decks"}
        onCancel={() => setPending(null)}
        onConfirm={confirmDelete}
        body={
          pending?.kind === "one" ? (
            <>
              <p>This removes the locally stored deck and its study progress.</p>
              <p>The original .apkg file on your computer will not be affected.</p>
            </>
          ) : (
            <>
              <p>
                This removes every deck this site has saved in this browser, along with their cards,
                media and study progress.
              </p>
              <p>
                The original .apkg files on your computer will not be affected, and no other site
                data is touched.
              </p>
            </>
          )
        }
      />
    </div>
  );
}

/**
 * The page's title, set as three flashcards: "Flashcards" on cream, "for" on
 * a small mint card, "All" on cream, with more cards fanned behind. It is a
 * real heading with real text; the cards behind it are decoration.
 */
function HeroTitle() {
  return (
    <div className="relative mx-auto w-fit">
      <h1
        className="relative mx-auto flex w-fit flex-col items-center font-display font-bold"
        style={
          {
            fontSize: "clamp(2.9rem, 13vw, 5.75rem)",
            "--radius-card": "0.16em",
            "--paper-inset": "0.09em",
          } as CSSProperties
        }
      >
        <span
          aria-hidden
          className="paper paper-flat paper-mint absolute left-[-7%] top-[6%] h-[54%] w-[46%]"
          style={{ transform: "rotate(-10deg)" }}
        />
        <span
          aria-hidden
          className="paper paper-flat paper-blue absolute right-[-8%] top-[20%] h-[50%] w-[40%]"
          style={{ transform: "rotate(8deg)" }}
        />
        <span
          aria-hidden
          className="paper paper-flat paper-tan absolute bottom-[-3%] left-[12%] h-[46%] w-[40%]"
          style={{ transform: "rotate(-8deg)" }}
        />
        <span
          className="paper relative z-[1] block px-[0.42em] pb-[0.14em] pt-[0.06em] leading-[1.15] tracking-[-0.015em]"
          style={{ transform: "rotate(-3deg)" }}
        >
          Flashcards
        </span>{" "}
        <span className="relative z-[2] mt-[-0.16em] flex items-end gap-[0.12em] pl-[0.5em]">
          <span
            className="paper paper-mint block px-[0.5em] pb-[0.2em] pt-[0.08em] text-[0.62em] font-semibold italic leading-[1.15]"
            style={{ transform: "translateY(-0.5em) rotate(-5deg)" }}
          >
            for
          </span>{" "}
          <span
            className="paper block px-[0.4em] pb-[0.1em] pt-[0.04em] leading-[1.15]"
            style={{ transform: "rotate(3deg)" }}
          >
            All
          </span>
        </span>
      </h1>

      <Sparkle twinkle={0.6} className="absolute -left-[9%] -top-[6%] h-5 w-5 text-gold" />
      <Sparkle className="absolute -right-[13%] top-[4%] h-7 w-7 text-gold" />
      <Sparkle twinkle={2.4} className="absolute -left-[4%] bottom-[2%] h-6 w-6 text-gold" />
      <Sparkle className="absolute -right-[10%] bottom-[6%] h-5 w-5 text-gold" />
      <Sparkle className="absolute left-[38%] -top-[13%] h-3 w-3 text-accent" />

      {/* Asides in the margin, where the page is wide enough for them. */}
      <div className="absolute right-[calc(100%+2.75rem)] top-[10%] hidden w-36 flex-col items-center lg:flex">
        <DoodleCap className="h-12 w-16 -rotate-12 text-accent" />
        <HandNote className="mt-3 -rotate-12">
          Learn
          <br />
          anything
        </HandNote>
      </div>
      <DoodleDash className="absolute right-[calc(100%-0.5rem)] top-[30%] hidden h-12 w-16 text-hand opacity-60 lg:block" />
      <div className="absolute left-[calc(100%+2.75rem)] top-[4%] hidden w-36 flex-col items-center lg:flex">
        <DoodleBulb className="h-14 w-11 text-hand" />
        <HandNote className="mt-3 rotate-3">
          One card
          <br />
          at a time
        </HandNote>
      </div>
      <DoodleDash flip className="absolute left-[calc(100%-0.5rem)] top-[30%] hidden h-12 w-16 text-hand opacity-60 lg:block" />
    </div>
  );
}

/** A flashcard on a small stack: what the thing you are about to study looks like. Decoration. */
function PreviewCard() {
  return (
    <div aria-hidden className="relative mx-auto hidden aspect-[3/2] w-full max-w-[19rem] md:block">
      <span
        className="paper paper-flat paper-blue absolute inset-0"
        style={{ transform: "translate(14px, 10px) rotate(4deg)" }}
      />
      <span
        className="paper paper-flat paper-mint absolute inset-0"
        style={{ transform: "translate(6px, -8px) rotate(-1deg)" }}
      />
      <div
        className="paper absolute inset-0 flex flex-col items-center justify-center px-7 text-center font-display"
        style={{ transform: "rotate(-6deg)" }}
      >
        <p className="text-[2rem] font-bold leading-none">curious</p>
        <p className="mt-1.5 text-[1.05rem] italic text-accent">adjective</p>
        <Ornament className="my-2.5 text-[0.95rem]" />
        <p className="text-[1.1rem] leading-snug">eager to learn or know about something.</p>
      </div>
      <Sparkle twinkle={1.2} className="absolute -left-6 bottom-6 h-6 w-6 text-gold" />
      <Sparkle className="absolute -right-3 -top-5 h-4 w-4 text-gold" />
      <Sparkle className="absolute -left-2 top-2 h-3.5 w-3.5 text-gold" />
    </div>
  );
}

/**
 * The explanatory picture: the front of a card, the same card's back, and the
 * move to the next one — all shown at once, because this is a diagram. (The
 * study screen itself only ever shows one side of one card.)
 */
function HowItWorksArt() {
  return (
    <div
      role="img"
      aria-label="A flashcard with the word “curious” on its front. Flipping the card shows its back: curious, adjective, eager to learn or know about something. Then you move on to the next card in the deck."
      className="mt-9 flex flex-col items-center gap-7 border-t border-panel-border pt-9 md:flex-row md:justify-center md:gap-4 lg:gap-7"
    >
      <figure className="relative w-full max-w-[15.5rem] shrink-0">
        <HandNote className="mb-2 -rotate-3 text-center">1. Read the front…</HandNote>
        <div
          className="paper flex aspect-[3/2] flex-col items-center justify-center font-display"
          style={{ transform: "rotate(-3deg)" }}
        >
          <p className="text-[2.6rem] font-bold leading-none">curious</p>
          <Ornament className="mt-3 text-base" />
        </div>
      </figure>

      <div className="flex shrink-0 rotate-90 flex-col items-center md:rotate-0">
        <DoodleArrow className="h-9 w-16 text-accent" />
        <HandNote className="hidden text-center md:block">flip it</HandNote>
      </div>

      <figure className="relative w-full max-w-[15.5rem] shrink-0">
        <HandNote className="mb-2 rotate-2 text-center">2. …check the back</HandNote>
        <div
          className="paper paper-back flex aspect-[3/2] flex-col items-center justify-center px-5 text-center font-display"
          style={{ transform: "rotate(2deg)" }}
        >
          <p className="text-[1.5rem] font-bold leading-none">curious</p>
          <p className="mt-1 text-[0.95rem] italic text-accent">adjective</p>
          <Ornament className="my-2 text-[0.85rem]" />
          <p className="text-[0.98rem] leading-snug">eager to learn or know about something.</p>
        </div>
      </figure>

      <div className="flex shrink-0 rotate-90 flex-col items-center md:rotate-0">
        <DoodleArrow className="h-9 w-16 text-accent" />
        <HandNote className="hidden text-center md:block">next</HandNote>
      </div>

      <figure className="relative w-full max-w-[9.5rem] shrink-0">
        <HandNote className="mb-2 -rotate-2 text-center">3. Keep going</HandNote>
        <div className="relative aspect-[3/2]">
          <span
            className="paper paper-flat paper-blue absolute inset-0"
            style={{ transform: "translate(8px, 5px) rotate(7deg)" }}
          />
          <span
            className="paper paper-flat paper-mint absolute inset-0"
            style={{ transform: "translate(-5px, 6px) rotate(-5deg)" }}
          />
          <span className="paper absolute inset-0 flex items-center justify-center" style={{ "--paper-inset": "0.4rem" } as CSSProperties}>
            <Sparkle className="h-5 w-5 text-[#c79a45]" />
          </span>
        </div>
      </figure>
    </div>
  );
}

function DeckRow({
  deck,
  knownCount,
  onStudy,
  onDownload,
  onDelete,
}: {
  deck: UploadedDeckMeta;
  knownCount: number;
  onStudy: () => void;
  onDownload?: () => void;
  onDelete: () => void;
}) {
  const tint = deckTint(deck.slug);
  const meta = [plural(deck.cardCount, "card"), plural(deck.chapterCount, "chapter")];
  if (deck.fileSize !== undefined) meta.push(formatBytes(deck.fileSize) ?? "");

  return (
    <li data-slug={deck.slug} className="flex items-center gap-3 px-3 py-3 first:rounded-t-2xl last:rounded-b-2xl sm:gap-4 sm:px-4">
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-display text-lg font-bold"
        style={{ background: `var(--tint-${tint}-bg)`, color: `var(--tint-${tint}-fg)` }}
      >
        {deckInitial(deck.title)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-snug">{deck.title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">
          {meta.join(" · ")}
          {knownCount > 0 && <span className="text-accent"> · {knownCount} known</span>}
        </p>
      </div>

      <Button size="sm" onClick={onStudy} className="group px-3.5">
        Study
        <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
      </Button>
      <OverflowMenu
        label={`More actions for ${deck.title}`}
        items={[
          ...(onDownload
            ? [
                {
                  label: "Download original .apkg",
                  icon: <Download className="h-4 w-4" />,
                  onSelect: onDownload,
                },
              ]
            : []),
          {
            label: "Delete from this browser",
            icon: <Trash2 className="h-4 w-4" />,
            tone: "danger" as const,
            onSelect: onDelete,
          },
        ]}
      />
    </li>
  );
}

function Step({
  icon,
  tone,
  title,
  children,
}: {
  icon: ReactNode;
  tone: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-4">
      <span
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1 ring-panel-border"
        style={{ background: `var(--tint-${tone}-bg)`, color: `var(--tint-${tone}-fg)` }}
      >
        {icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <h3 className="font-display text-[1.1rem] font-bold leading-snug">{title}</h3>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5 py-4 sm:flex-col sm:gap-0" style={{ paddingInline: "var(--space-panel)" }}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <div className="min-w-0 sm:mt-3">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}
