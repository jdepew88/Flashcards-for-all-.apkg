// Landing / upload screen.
//
// Derived from CCNA Practice Labs' src/components/flashcards/flashcard-upload.tsx
// (same parser call, same on-device deck list, same error handling) but rebuilt
// as the whole landing page rather than a card at the bottom of a course page.
// Added here: a real drag-and-drop target, a format summary, and a sample deck.

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  FileDown,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  WalletCards,
} from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ApkgParseError, parseApkgFile } from "@/lib/flashcards/client-import";
import {
  deleteUploadedDeck,
  listUploadedDecks,
  saveUploadedDeck,
  type UploadedDeckMeta,
} from "@/lib/flashcards/uploaded-decks";

type Status =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "error"; message: string };

const SAMPLE_DECK_URL = "/sample-deck.apkg";

export function UploadScreen({ onStudy }: { onStudy: (slug: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [decks, setDecks] = useState<UploadedDeckMeta[] | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    listUploadedDecks()
      .then(setDecks)
      .catch(() => setDecks([]));
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus({ kind: "working", message: "Reading file…" });
    try {
      const { deck, media } = await parseApkgFile(file, (message) =>
        setStatus({ kind: "working", message })
      );
      setStatus({ kind: "working", message: "Saving to this device…" });
      await saveUploadedDeck(deck, media);
      setDecks(await listUploadedDecks());
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

  async function handleDelete(slug: string) {
    await deleteUploadedDeck(slug);
    setDecks(await listUploadedDecks());
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (isWorking) return;
    handleFile(event.dataTransfer.files?.[0]);
  }

  const isWorking = status.kind === "working";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header>
        <Badge>Runs entirely in your browser</Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Flashcard Study Tool</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Upload a compatible flashcard deck and study it directly in your browser. Tap a card to
          reveal the answer, swipe or use the arrow keys to move between cards, and mark the ones you
          already know so you can drill down on what is left.
        </p>
      </header>

      <Card className="mt-8 border-dashed">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
              <Upload className="h-4.5 w-4.5" />
            </span>
            <CardTitle>Upload a deck</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Drop in an Anki{" "}
            <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">.apkg</code> export. It is
            parsed entirely in your browser and stored only on this device — nothing is uploaded
            anywhere.
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
                <span className="text-xs text-muted-foreground">
                  Up to 200MB, processed on-device
                </span>
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
              Six cards across three chapters, so you can see how it works before uploading your
              own.
            </span>
          </div>

          {decks && decks.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Decks on this device
              </p>
              {decks.map((deck) => (
                <div
                  key={deck.slug}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2.5"
                >
                  <WalletCards className="h-4 w-4 shrink-0 text-brand-blue" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{deck.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {deck.cardCount} cards &middot; {deck.chapterCount} chapters
                    </p>
                  </div>
                  <button
                    onClick={() => onStudy(deck.slug)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  >
                    Study
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${deck.title}`}
                    onClick={() => handleDelete(deck.slug)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-surface-elevated px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
        <p>
          <strong className="font-medium text-foreground">
            Your flashcard file is processed locally in your browser and is not uploaded to a server.
          </strong>{" "}
          Decks you open are kept in this browser&apos;s storage on this device so you can come back
          to them, and the delete button removes them. There is no account, no analytics and no
          backend.
        </p>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Supported file format</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          One file type is accepted: an Anki deck package with a{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">.apkg</code> extension,
          exported from Anki with <em>File → Export → Anki Deck Package</em>. Both the older{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">collection.anki2</code> and
          the newer <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
            collection.anki21
          </code>{" "}
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
            &middot; If Anki offers a &ldquo;Support older Anki versions&rdquo; checkbox on export,
            tick it — the newest compressed export format cannot be read in a browser.
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          This is the same format, parsed by the same code, as the flashcard tool on CCNA Practice
          Labs — any deck that works there works here unchanged.
        </p>
      </section>
    </div>
  );
}
