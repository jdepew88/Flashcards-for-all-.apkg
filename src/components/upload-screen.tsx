// Landing page: explain the tool, import a deck, and manage the local library.
//
// Derived from CCNA Practice Labs' src/components/flashcards/flashcard-upload.tsx
// (same parser call, same on-device deck list, same error handling), rebuilt as
// the whole landing page rather than a card at the bottom of a course page, and
// extended with the deck library, confirmed deletion, "download original" and
// the storage/privacy disclosures.
//
// Everything on this screen is local. The only network request it can make is
// `fetch("/sample-deck.apkg")` for the bundled sample — a static asset of this
// site, fetched only when the visitor asks for it. No deck data ever leaves.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  FileDown,
  HardDrive,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  WalletCards,
} from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
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
import { deleteAllDeckProgress, deleteDeckProgress } from "@/lib/stores/known-store";
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

export function UploadScreen({ onStudy }: { onStudy: (slug: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [decks, setDecks] = useState<UploadedDeckMeta[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [persistence, setPersistence] = useState<PersistenceState>({ status: "unsupported" });
  const [estimate, setEstimate] = useState<StorageEstimate>({});

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

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (isWorking) return;
    handleFile(event.dataTransfer.files?.[0]);
  }

  const isWorking = status.kind === "working";
  const usage = formatBytes(estimate.usageBytes);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header>
        <Badge>Runs entirely in your browser</Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Flashcard Study Tool</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Import a flashcard deck and study it directly in your browser. Tap a card to reveal the
          answer, swipe or use the arrow keys to move between cards, and mark the ones you already
          know so you can drill down on what is left.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Import                                                            */}
      {/* ---------------------------------------------------------------- */}
      <Card className="mt-8 border-dashed">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
              <Upload className="h-4.5 w-4.5" />
            </span>
            <CardTitle>Import .apkg</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Choose an Anki <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">.apkg</code>{" "}
            export from your computer.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label
            htmlFor="apkg-upload"
            onDragOver={(event) => {
              event.preventDefault();
              if (!isWorking) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging
                ? "border-brand-blue bg-brand-blue/10"
                : "border-border hover:border-brand-blue/50 hover:bg-brand-blue/5"
            )}
          >
            {isWorking ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-brand-blue" />
                <span className="text-sm text-muted-foreground">{status.message}</span>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">
                  Drop a .apkg file here, or tap to choose one
                </span>
                <span className="text-xs text-muted-foreground">Up to 200MB</span>
              </>
            )}
            <input
              id="apkg-upload"
              ref={inputRef}
              type="file"
              accept=".apkg"
              className="sr-only"
              disabled={isWorking}
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
          </label>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs font-medium text-brand-green">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Processed and saved locally in your browser — never uploaded.
          </p>

          {status.kind === "error" && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{status.message}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={handleSampleDeck} disabled={isWorking}>
              <FileDown className="h-4 w-4" />
              Try a sample deck
            </Button>
            <span className="text-xs text-muted-foreground">
              Six cards across three chapters, so you can see how it works before importing your
              own.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Local deck library                                                */}
      {/* ---------------------------------------------------------------- */}
      {decks && decks.length > 0 && (
        <section className="mt-10" aria-labelledby="your-decks">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="your-decks" className="text-lg font-semibold tracking-tight">
              Your decks
            </h2>
            <span className="text-xs text-muted-foreground">Saved in this browser</span>
          </div>

          <ul aria-label="Saved decks" className="mt-3 flex flex-col gap-2">
            {decks.map((deck) => (
              <li
                key={deck.slug}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface-elevated px-3 py-3"
              >
                <WalletCards className="h-4 w-4 shrink-0 text-brand-blue" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">{deck.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {deck.cardCount} cards &middot; {deck.chapterCount} chapters
                    {deck.fileSize !== undefined && ` · ${formatBytes(deck.fileSize)}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => onStudy(deck.slug)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  >
                    Study
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>

                  {deck.hasSource && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      aria-label={`Download original .apkg for ${deck.title}`}
                      title="Download original .apkg"
                      onClick={() => handleDownloadSource(deck)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${deck.title}`}
                    onClick={() => setPending({ kind: "one", deck })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <button
            onClick={() => setPending({ kind: "all" })}
            className="mt-3 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-destructive"
          >
            Delete all locally saved decks
          </button>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Privacy and storage                                               */}
      {/* ---------------------------------------------------------------- */}
      <section className="mt-10" aria-labelledby="privacy">
        <h2 id="privacy" className="text-lg font-semibold tracking-tight">
          Your flashcards stay on this device
        </h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>
            Your <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">.apkg</code> deck is
            opened and processed directly in your browser. It is not uploaded to our servers.
          </p>
          <p>
            Imported decks are saved locally in this browser so you can return to them later. You
            can delete a saved deck at any time.
          </p>
          <p>
            This site is static files only. There is no account, no analytics, and no server that
            could receive a deck — the page itself downloads to your browser and does the work
            there.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-elevated px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
            About storage on this device
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>Saved decks belong to this browser on this device.</li>
            <li>
              They will not automatically appear on another computer, phone, browser, or browser
              profile.
            </li>
            <li>Clearing this site&apos;s browser data will remove locally saved decks.</li>
            {persistence.status === "persisted" && (
              <li>
                This browser has granted persistent storage, so it will not evict saved decks on its
                own to reclaim space. It is not a permanent guarantee — clearing site data still
                removes them.
              </li>
            )}
            {persistence.status === "best-effort" && (
              <li>
                This browser has not granted persistent storage, so it may remove saved decks if the
                device runs very low on space. Keep your original{" "}
                <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">.apkg</code> files.
              </li>
            )}
            {usage && <li>This site is currently using about {usage} of browser storage.</li>}
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Format reference                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Supported file format</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          One file type is accepted: an Anki deck package with a{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">.apkg</code> extension,
          exported from Anki with <em>File → Export → Anki Deck Package</em>. Both the older{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">collection.anki2</code> and
          the newer{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">collection.anki21</code>{" "}
          layouts are read.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li>
            &middot; Card fronts and backs are produced by running each note through its own Anki
            card template, so basic, reversed and cloze notes all work.
          </li>
          <li>&middot; Anki subdeck names become the chapter filter; note tags are carried across.</li>
          <li>&middot; Images and audio bundled in the deck are extracted and shown on the card.</li>
          <li>
            &middot; Card content is sanitized on import: scripts, embedded objects and remote media
            are stripped, so a deck from someone else cannot run code or call out to the network.
          </li>
          <li>
            &middot; If Anki offers a &ldquo;Support older Anki versions&rdquo; checkbox on export,
            tick it — the newest compressed export format cannot be read in a browser.
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          Importing a deck never changes the original file on your computer — it is only read.
        </p>
      </section>

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
