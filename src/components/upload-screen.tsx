// Landing page: import a deck, and pick up one you imported before.
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

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Download,
  EyeOff,
  HardDrive,
  Info,
  Layers,
  Loader2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { buttonClasses } from "@/components/ui/button-styles";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OverflowMenu } from "@/components/ui/menu";
import { LogoMark } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
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
    <div className="hero-glow min-h-dvh">
      <div className="page-gutter mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
        <header
          className="flex items-center justify-between pb-2"
          style={{ paddingTop: "max(0.875rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <span className="text-[15px] font-semibold tracking-tight">Flashcards</span>
          </div>
          <ThemeToggle className="-mr-2" />
        </header>

        <main className="flex-1 pb-10">
          {/* -------------------------------------------------------- hero -- */}
          <section className="pt-9 text-center sm:pt-16">
            <h1 className="mx-auto max-w-xl text-[2.125rem] font-bold leading-[1.08] tracking-[-0.025em] sm:text-[3.25rem]">
              Study any Anki deck, privately.
            </h1>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted sm:text-base">
              Import a compatible Anki deck and study it right here in your browser — tap to
              flip, swipe to move, and come back to it any time.
            </p>
          </section>

          {/* ------------------------------------------------------ import -- */}
          <section aria-label="Import a deck" className="mx-auto mt-8 max-w-xl sm:mt-10">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              data-dragging={dragging}
              className={cn(
                "rounded-[1.75rem] border bg-surface-elevated p-2 shadow-panel transition-[border-color,background-color,box-shadow] duration-200",
                dragging ? "border-accent bg-accent-soft" : "border-border"
              )}
            >
              <div
                className={cn(
                  "flex flex-col items-center gap-3 rounded-[1.35rem] border border-dashed px-5 py-7 text-center transition-colors sm:py-9",
                  dragging ? "border-accent" : "border-border-strong/80"
                )}
              >
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
                  className={buttonClasses(
                    "primary",
                    "lg",
                    cn(
                      "min-w-52 text-base peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
                      isWorking && "pointer-events-none opacity-70"
                    )
                  )}
                >
                  {isWorking ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                  {isWorking ? "Importing…" : "Import .apkg"}
                </label>

                <p className="text-sm text-muted" aria-live="polite">
                  {isWorking ? (
                    status.message
                  ) : dragging ? (
                    <span className="font-medium text-accent">Drop to import</span>
                  ) : (
                    <>
                      <span className="hidden [@media(hover:hover)]:inline">
                        or drop a file here ·{" "}
                      </span>
                      Anki &ldquo;Deck Package&rdquo; export, up to 200 MB
                    </>
                  )}
                </p>
              </div>

              <p className="flex items-center justify-center gap-1.5 px-3 pb-1.5 pt-3 text-center text-[13px] font-medium text-success">
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
                  className="mt-3 flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{status.message}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-sm">
              <span className="text-muted">New here?</span>
              <button
                type="button"
                onClick={handleSampleDeck}
                disabled={isWorking}
                className="group inline-flex min-h-10 items-center gap-1 rounded-lg px-1.5 font-semibold text-accent transition-colors hover:text-accent-hover disabled:opacity-50"
              >
                Try a sample deck
                <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
              </button>
            </div>
          </section>

          {/* ----------------------------------------------------- library -- */}
          {decks && decks.length > 0 && (
            <section className="mt-12 sm:mt-14" aria-labelledby="your-decks">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 id="your-decks" className="text-lg font-semibold tracking-tight">
                  Your decks
                </h2>
                <span className="text-xs text-muted">Saved in this browser</span>
              </div>

              <ul
                aria-label="Saved decks"
                className="mt-3 divide-y divide-border rounded-3xl border border-border bg-surface-elevated shadow-soft"
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

              <div className="mt-2 flex justify-end">
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
              className="mx-auto mt-12 flex max-w-xl items-center gap-4 rounded-3xl border border-dashed border-border-strong/80 px-5 py-5 sm:mt-14"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-muted">
                <Layers className="h-5 w-5" />
              </span>
              <p className="text-sm leading-relaxed text-muted">
                <span className="font-semibold text-foreground">Your decks will appear here.</span>{" "}
                Imported decks stay saved in this browser, so they&apos;re waiting for you next
                time.
              </p>
            </section>
          )}

          {/* ----------------------------------------------------- privacy -- */}
          <section className="mt-14 sm:mt-20" aria-labelledby="privacy">
            <h2 id="privacy" className="px-1 text-lg font-semibold tracking-tight">
              Your flashcards stay on this device
            </h2>
            <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-surface-elevated shadow-soft">
              <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
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

            <div className="border-t border-border bg-surface px-5 py-4">
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
            </div>
          </section>

          {/* ------------------------------------------------------ format -- */}
          <section className="mt-10 px-1" aria-labelledby="format">
            <h2 id="format" className="text-lg font-semibold tracking-tight">
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
          className="border-t border-border py-5 text-center text-xs text-muted"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          Flashcards runs entirely in your browser. No account, no cookies, no analytics.
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
    <li className="flex items-center gap-3 px-3 py-3 first:rounded-t-3xl last:rounded-b-3xl sm:gap-4 sm:px-4">
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-base font-bold"
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

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5 px-5 py-4 sm:flex-col sm:gap-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <div className="min-w-0 sm:mt-3">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}
