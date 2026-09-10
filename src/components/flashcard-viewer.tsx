// Adapted from CCNA Practice Labs — src/components/flashcards/flashcard-viewer.tsx.
//
// Behavior kept identical: chapter filter, hide-known, shuffle, tap-to-reveal,
// double-tap to flip back, horizontal swipe to move, arrow keys, space/enter to
// flip, swipe-up (or ArrowUp) for the options sheet, per-card "known" marking,
// progress bar and counter.
//
// Adaptations for the standalone build:
//   * `useRouter()` is replaced by an `onExit` callback — this app has no
//     Next.js router, and "exit" here means "go back to the upload screen".
//   * Explicit Previous / Next / Restart controls were added. On the CCNA site
//     the only way forward on a desktop was an arrow key, which is not
//     discoverable for someone handed a bare link with no instructions.
//   * "Reset progress" in the options sheet clears this deck's known marks.
//   * The key handler ignores events originating in a form control, so the
//     chapter <select> keeps its normal keyboard behavior.

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, ChevronUp, RotateCcw, Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import { FLASHCARD_FONTS } from "@/lib/fonts";
import { FlashcardOptionsSheet } from "@/components/flashcard-options-sheet";
import { sanitizeCardHtml } from "@/lib/flashcards/sanitize";
import type { Flashcard, FlashcardDeck } from "@/lib/flashcards/types";

const TAP_MAX_DISTANCE = 10;
const SWIPE_THRESHOLD = 70;
const DOUBLE_TAP_WINDOW_MS = 400;

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isFormControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "OPTION"].includes(target.tagName)
  );
}

export function FlashcardViewer({ deck, onExit }: { deck: FlashcardDeck; onExit: () => void }) {
  const [chapter, setChapter] = useState("all");
  const [hideKnown, setHideKnown] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [shuffleNonce, setShuffleNonce] = useState(0);
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const font = useFlashcardPrefsStore((s) => s.font);
  const fontSize = useFlashcardPrefsStore((s) => s.fontSize);
  const setFont = useFlashcardPrefsStore((s) => s.setFont);
  const setFontSize = useFlashcardPrefsStore((s) => s.setFontSize);
  const fontFamily =
    FLASHCARD_FONTS.find((f) => f.id === font)?.variable ?? FLASHCARD_FONTS[0].variable;

  const knownByDeck = useFlashcardsStore((s) => s.knownByDeck);
  const markKnown = useFlashcardsStore((s) => s.markKnown);
  const resetDeck = useFlashcardsStore((s) => s.resetDeck);
  const knownIds = useMemo(() => knownByDeck[deck.slug] ?? [], [knownByDeck, deck.slug]);
  const knownSet = useMemo(() => new Set(knownIds), [knownIds]);

  const filteredIndices = useMemo(() => {
    let indices = deck.cards.map((_, i) => i);
    if (chapter !== "all") {
      indices = indices.filter((i) => deck.cards[i].chapter === chapter);
    }
    if (hideKnown) {
      indices = indices.filter((i) => !knownSet.has(deck.cards[i].id));
    }
    return indices;
  }, [deck.cards, chapter, hideKnown, knownSet]);

  const order = useMemo(
    () => (shuffle ? shuffleArray(filteredIndices) : filteredIndices),
    // `shuffleNonce` lets Restart reshuffle while shuffle mode stays on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredIndices, shuffle, shuffleNonce]
  );

  // Reset position/flip whenever the active filter or shuffle produces a
  // different card order (adjusting state during render, not in an effect).
  const [lastOrder, setLastOrder] = useState(order);
  if (order !== lastOrder) {
    setLastOrder(order);
    setPosition(0);
    setFlipped(false);
  }

  const total = order.length;
  const currentIndex = order[position];
  const currentCard: Flashcard | null = currentIndex !== undefined ? deck.cards[currentIndex] : null;
  const isKnownCurrent = currentCard ? knownSet.has(currentCard.id) : false;

  const lastTapAtRef = useRef(0);
  const pendingTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingTapTimer.current) clearTimeout(pendingTapTimer.current);
    };
  }, []);

  function goTo(next: number) {
    if (next < 0 || next >= total) return;
    setPosition(next);
    setFlipped(false);
  }

  function handleRestart() {
    setPosition(0);
    setFlipped(false);
    if (shuffle) setShuffleNonce((n) => n + 1);
  }

  function handleResetProgress() {
    resetDeck(deck.slug);
    setOptionsOpen(false);
  }

  function handleTap() {
    const now = Date.now();
    const isDoubleTap = now - lastTapAtRef.current < DOUBLE_TAP_WINDOW_MS;
    lastTapAtRef.current = isDoubleTap ? 0 : now;

    if (isDoubleTap) {
      if (pendingTapTimer.current) {
        clearTimeout(pendingTapTimer.current);
        pendingTapTimer.current = null;
      }
      setFlipped(false);
      return;
    }

    pendingTapTimer.current = setTimeout(() => {
      pendingTapTimer.current = null;
      setFlipped(true);
    }, DOUBLE_TAP_WINDOW_MS);
  }

  const justDraggedRef = useRef(false);

  function handleCardDragEnd(_event: unknown, info: PanInfo) {
    const { x } = info.offset;
    if (Math.abs(x) < TAP_MAX_DISTANCE) return;

    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 300);

    if (x < -SWIPE_THRESHOLD) goTo(position + 1);
    else if (x > SWIPE_THRESHOLD) goTo(position - 1);
  }

  function handleCardClick() {
    if (justDraggedRef.current) return;
    handleTap();
  }

  // Native dblclick as a safety net alongside the timestamp-based double-tap
  // detection in handleTap — desktop double-clicks fire this reliably even if
  // the two underlying click events land outside the custom timing window.
  function handleCardDoubleClick() {
    if (pendingTapTimer.current) {
      clearTimeout(pendingTapTimer.current);
      pendingTapTimer.current = null;
    }
    setFlipped(false);
  }

  function handleHandleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.y < -50) setOptionsOpen(true);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (optionsOpen) {
        if (event.key === "Escape") setOptionsOpen(false);
        return;
      }
      if (isFormControl(event.target)) return;
      if (event.key === "ArrowRight") goTo(position + 1);
      else if (event.key === "ArrowLeft") goTo(position - 1);
      else if (event.key === "ArrowUp") setOptionsOpen(true);
      else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setFlipped((f) => !f);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, total, optionsOpen]);

  function toggleKnown(event: React.MouseEvent) {
    event.stopPropagation();
    if (!currentCard) return;
    markKnown(deck.slug, currentCard.id, !isKnownCurrent);
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col px-3 py-3 sm:px-6 sm:py-5">
      <div className="flex items-center justify-between gap-2 pb-3">
        <p className="min-w-0 truncate text-sm font-semibold" title={deck.title}>
          {deck.title}
        </p>
        <button
          onClick={onExit}
          className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
        >
          Load another deck
        </button>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={chapter}
          onChange={(event) => setChapter(event.target.value)}
          aria-label="Filter by chapter"
          className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
        >
          <option value="all">All chapters ({deck.cards.length})</option>
          {deck.chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.cardCount})
            </option>
          ))}
        </select>
        <button
          onClick={() => setShuffle((s) => !s)}
          aria-pressed={shuffle}
          aria-label="Shuffle order"
          title="Shuffle order"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
            shuffle
              ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
              : "border-border text-muted-foreground hover:bg-surface-muted"
          )}
        >
          <Shuffle className="h-4 w-4" />
        </button>
        <button
          onClick={handleRestart}
          aria-label="Restart deck"
          title="Restart from the first card"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-surface-muted"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={() => setHideKnown((v) => !v)}
          aria-pressed={hideKnown}
          title={hideKnown ? "Showing unknown only" : "Hide known cards"}
          className={cn(
            "h-9 shrink-0 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            hideKnown
              ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
              : "border-border text-muted-foreground hover:bg-surface-muted"
          )}
        >
          {hideKnown ? "Hiding known" : "Hide known"}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="card-counter">
          {total > 0 ? position + 1 : 0} / {total}
        </span>
        <span>{knownSet.size} known</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full bg-brand-blue transition-all duration-300"
          style={{ width: total > 0 ? `${((position + 1) / total) * 100}%` : "0%" }}
        />
      </div>

      <div
        className="relative mt-3 min-h-[320px] flex-1 sm:min-h-[420px]"
        style={{ perspective: 1600 }}
      >
        {currentCard ? (
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={currentCard.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              drag="x"
              dragElastic={0.6}
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={handleCardDragEnd}
              onClick={handleCardClick}
              onDoubleClick={handleCardDoubleClick}
              className="absolute inset-0 cursor-pointer select-none"
            >
              <motion.div
                className="relative h-full w-full"
                data-testid="card-flipper"
                data-flipped={flipped}
                style={{ transformStyle: "preserve-3d" }}
                animate={{ rotateY: flipped ? 180 : 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <div
                  className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl border border-border bg-surface-elevated shadow-xl"
                  style={{ backfaceVisibility: "hidden" }}
                >
                  <CardFace
                    label="Question"
                    chapter={currentCard.chapter}
                    html={currentCard.front}
                    fontFamily={fontFamily}
                    fontSize={fontSize}
                    known={isKnownCurrent}
                    onToggleKnown={toggleKnown}
                  />
                </div>
                <div
                  className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl border border-brand-blue/40 bg-surface-elevated shadow-xl"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  <CardFace
                    label="Answer"
                    chapter={currentCard.chapter}
                    html={currentCard.back}
                    fontFamily={fontFamily}
                    fontSize={fontSize}
                    accent
                    known={isKnownCurrent}
                    onToggleKnown={toggleKnown}
                  />
                </div>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">
            No cards match this filter.
            <button
              onClick={() => {
                setChapter("all");
                setHideKnown(false);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-muted"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => goTo(position - 1)}
          disabled={position <= 0}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>
        <button
          onClick={() => setFlipped((f) => !f)}
          disabled={!currentCard}
          className="h-11 shrink-0 rounded-xl border border-brand-blue bg-brand-blue/10 px-4 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-blue/20 disabled:opacity-40"
        >
          {flipped ? "Question" : "Reveal"}
        </button>
        <button
          onClick={() => goTo(position + 1)}
          disabled={position >= total - 1}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <motion.button
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.4, bottom: 0 }}
        onDragEnd={handleHandleDragEnd}
        onClick={() => setOptionsOpen(true)}
        className="mx-auto mt-2 flex touch-none flex-col items-center gap-1 rounded-full px-6 py-2 text-muted-foreground"
        aria-label="Open reading options"
      >
        <ChevronUp className="h-4 w-4" />
        <span className="text-center text-[11px] leading-tight">
          Tap for answer &middot; double-tap to flip back &middot; swipe to move &middot; swipe up
          for options
        </span>
      </motion.button>

      <FlashcardOptionsSheet
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        onExit={() => {
          setOptionsOpen(false);
          onExit();
        }}
        onResetProgress={handleResetProgress}
        font={font}
        onFontChange={setFont}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
      />
    </div>
  );
}

function CardFace({
  label,
  chapter,
  html,
  accent,
  fontFamily,
  fontSize,
  known,
  onToggleKnown,
}: {
  label: string;
  chapter: string;
  html: string;
  accent?: boolean;
  fontFamily: string;
  fontSize: number;
  known: boolean;
  onToggleKnown: (event: React.MouseEvent) => void;
}) {
  // Sanitized again here, not just at import: a deck stored by an earlier
  // version of the app was cleaned by that version's rules, and this is the
  // last point before the HTML reaches the DOM. `allowBareMedia: false`
  // because bundled media has already been resolved to blob: URLs by now, so
  // anything still carrying a plain src would be a network request the deck
  // author chose rather than one the deck's own files justify.
  const safeHtml = useMemo(
    () => sanitizeCardHtml(html, { allowBareMedia: false }),
    [html]
  );

  return (
    <>
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 sm:px-6">
        <Badge variant={accent ? "success" : "outline"}>{label}</Badge>
        <span
          className="mx-2 min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground"
          title={chapter}
        >
          {chapter}
        </span>
        <button
          onClick={onToggleKnown}
          aria-pressed={known}
          aria-label={known ? "Marked as known — tap to unmark" : "Mark as known"}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
            known
              ? "border-brand-green bg-brand-green/15 text-brand-green"
              : "border-border text-muted-foreground hover:bg-surface-muted"
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        className="anki-card-content flex-1 overflow-y-auto px-5 py-5 leading-relaxed sm:px-8 sm:py-6"
        style={{ fontFamily, fontSize: `${fontSize}px` }}
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </>
  );
}
