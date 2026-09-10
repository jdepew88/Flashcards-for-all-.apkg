// The study screen.
//
// Started as CCNA Practice Labs' src/components/flashcards/flashcard-viewer.tsx.
// The study model is unchanged — chapter filter, hide-known, shuffle, restart,
// per-card "known" marks, reading options, progress — and so is what progress
// means. The screen around it was redesigned:
//
//   * One focused column: a compact header, a slim progress line, the card as
//     the hero, and the controls. Filters and settings live in one Study
//     options sheet instead of a toolbar above the card.
//   * Controls adapt to the layout (never to a user-agent string):
//       phone-sized  → gestures by default, Previous/Flip/Next buttons optional
//       larger       → buttons always; gestures still work on the card
//     In gesture mode the buttons stay in the accessibility tree and appear
//     when keyboard focus reaches them, so gestures are never the only way.
//   * Tap flips (immediately — the old 400ms double-tap wait is gone), swipes
//     navigate with the card following the finger. See swipe-card.tsx.
//   * Keyboard: ← → move, Space / Enter / ↑ / ↓ flip, K marks known. Keys are
//     left alone while a form control, player or dialog has them, and whenever
//     a modifier is held (Alt+← is the browser's Back).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/theme-toggle";
import { SwipeCard, type CardMotion } from "@/components/swipe-card";
import { FlashcardOptionsSheet } from "@/components/flashcard-options-sheet";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import { FLASHCARD_FONTS } from "@/lib/fonts";
import {
  COMPACT_QUERY,
  FINE_POINTER_QUERY,
  useMediaQuery,
  usePrefersReducedMotion,
} from "@/lib/use-media-query";
import type { Flashcard, FlashcardDeck } from "@/lib/flashcards/types";

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** While one of these has focus, keys are theirs, not the study screen's. */
function ownsKeyboard(target: Element): boolean {
  return !!target.closest(
    "input, select, textarea, option, audio, video, [contenteditable], [role='slider'], [role='radiogroup'], [role='menu'], [role='listbox'], [role='tablist'], [role='dialog'], [role='alertdialog']"
  );
}

interface Toast {
  id: number;
  message: string;
  restart?: boolean;
}

export function FlashcardViewer({ deck, onExit }: { deck: FlashcardDeck; onExit: () => void }) {
  const [chapter, setChapter] = useState("all");
  const [hideKnown, setHideKnown] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [shuffleNonce, setShuffleNonce] = useState(0);
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const compact = useMediaQuery(COMPACT_QUERY);
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const reduced = usePrefersReducedMotion();

  const font = useFlashcardPrefsStore((s) => s.font);
  const fontSize = useFlashcardPrefsStore((s) => s.fontSize);
  const setFont = useFlashcardPrefsStore((s) => s.setFont);
  const setFontSize = useFlashcardPrefsStore((s) => s.setFontSize);
  const controlMode = useFlashcardPrefsStore((s) => s.controlMode);
  const setControlMode = useFlashcardPrefsStore((s) => s.setControlMode);
  const gestureHintSeen = useFlashcardPrefsStore((s) => s.gestureHintSeen);
  const markGestureHintSeen = useFlashcardPrefsStore((s) => s.markGestureHintSeen);
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
    setDirection(0);
  }

  const total = order.length;
  const currentIndex = order[position];
  const currentCard: Flashcard | null = currentIndex !== undefined ? deck.cards[currentIndex] : null;
  const isKnownCurrent = currentCard ? knownSet.has(currentCard.id) : false;
  const remaining = total - position - 1;

  const showButtons = !compact || controlMode === "buttons";
  const showHint = compact && controlMode === "gestures" && !gestureHintSeen && currentCard !== null;
  const showShortcutHint = finePointer && !compact;

  const motionCustom = useMemo<CardMotion>(
    () => ({ direction, width: cardWidth, reduced }),
    [direction, cardWidth, reduced]
  );

  // The study screen is a fixed-height app shell; while it is up, the page
  // must not scroll or overscroll (pull-to-refresh, horizontal history swipes).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("study-mode");
    return () => root.classList.remove("study-mode");
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setCardWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function go(step: 1 | -1) {
    const next = position + step;
    if (next < 0 || next >= total) {
      if (total > 0) {
        setToast({
          id: Date.now(),
          message: step > 0 ? "That's the last card." : "This is the first card.",
          restart: step > 0 && total > 1,
        });
      }
      return;
    }
    setDirection(step);
    setPosition(next);
    setFlipped(false);
    setAnnouncement(`Card ${next + 1} of ${total}`);
  }

  function flip() {
    if (!currentCard) return;
    const next = !flipped;
    setFlipped(next);
    setAnnouncement(next ? "Showing answer" : "Showing question");
  }

  function toggleKnown() {
    if (!currentCard) return;
    markKnown(deck.slug, currentCard.id, !isKnownCurrent);
  }

  function restart() {
    setDirection(0);
    setPosition(0);
    setFlipped(false);
    if (shuffle) setShuffleNonce((n) => n + 1);
    if (total > 0) setAnnouncement(`Card 1 of ${total}`);
  }

  function handleResetProgress() {
    resetDeck(deck.slug);
    setOptionsOpen(false);
    setToast({ id: Date.now(), message: "Progress cleared for this deck." });
  }

  function clearFilters() {
    setChapter("all");
    setHideKnown(false);
  }

  function retireHint() {
    if (showHint) markGestureHintSeen();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (optionsOpen || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && ownsKeyboard(target)) return;

      const onControl = !!target?.closest(
        "button, a[href], summary, [role='button'], [role='switch'], [role='menuitem']"
      );
      const inScrollingCard = !!target?.closest(".card-scroll");

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          go(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          go(-1);
          break;
        case "ArrowUp":
        case "ArrowDown":
          // A focused scrollable card uses these to scroll.
          if (onControl || inScrollingCard) return;
          event.preventDefault();
          flip();
          break;
        case " ":
        case "Enter":
          // A focused button already acts on Space/Enter; flipping too would double up.
          if (onControl) return;
          event.preventDefault();
          flip();
          break;
        case "k":
        case "K":
          toggleKnown();
          break;
        default:
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsOpen, position, total, flipped, currentCard, isKnownCurrent]);

  const chapterName = deck.chapters.find((c) => c.id === chapter)?.name;
  const filterSummary = [
    chapter !== "all" ? chapterName : null,
    shuffle ? "Shuffled" : null,
    hideKnown ? "Hiding known" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="study-shell mx-auto flex w-full max-w-5xl flex-col">
      <header className="safe-top mx-auto flex w-full max-w-3xl items-center gap-1 pb-1 sm:gap-2 sm:pb-2">
        <button
          type="button"
          onClick={onExit}
          aria-label="Back to your decks"
          className="-ml-1.5 inline-flex h-10 shrink-0 items-center gap-0.5 rounded-full pl-1.5 pr-2 text-sm font-medium text-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-muted hover:text-foreground active:scale-95 sm:pr-3.5"
        >
          <ChevronLeft className="h-5 w-5" />
          <span className="hidden sm:inline">Decks</span>
        </button>

        <div className="min-w-0 flex-1 px-1 text-center">
          <h1 className="truncate text-[15px] font-semibold leading-tight" title={deck.title}>
            {deck.title}
          </h1>
          {filterSummary && (
            <button
              type="button"
              onClick={() => setOptionsOpen(true)}
              className="mx-auto mt-0.5 block max-w-full truncate text-xs font-medium text-accent"
            >
              {filterSummary}
            </button>
          )}
        </div>

        <ThemeToggle />
        <button
          type="button"
          onClick={() => setOptionsOpen(true)}
          aria-label="Study options"
          aria-haspopup="dialog"
          aria-expanded={optionsOpen}
          className="-mr-1.5 inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-full px-2.5 text-sm font-medium text-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-muted hover:text-foreground active:scale-95 sm:mr-0 sm:px-3.5"
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
          <span className="hidden sm:inline">Options</span>
        </button>
      </header>

      <div className="mx-auto w-full max-w-[40rem] px-1 pt-1">
        <div
          role="progressbar"
          aria-label="Position in deck"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={total > 0 ? position + 1 : 0}
          aria-valuetext={total > 0 ? `Card ${position + 1} of ${total}` : "No cards"}
          className="h-1 w-full overflow-hidden rounded-full bg-surface-muted"
        >
          <motion.div
            className="h-full w-full origin-left rounded-full bg-accent"
            initial={false}
            animate={{ scaleX: total > 0 ? (position + 1) / total : 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 32 }}
          />
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center pt-4 sm:pt-6">
        <div
          ref={stageRef}
          className="relative min-h-0 w-full max-w-[40rem] flex-1 sm:max-h-[38rem]"
        >
          {/* The rest of the deck, peeking out underneath. */}
          {currentCard && remaining >= 2 && (
            <div
              aria-hidden
              className="absolute inset-x-5 -bottom-3 top-5 rounded-[1.75rem] border border-card-border bg-card opacity-55"
            />
          )}
          {currentCard && remaining >= 1 && (
            <div
              aria-hidden
              className="absolute inset-x-2.5 -bottom-1.5 top-2.5 rounded-[1.75rem] border border-card-border bg-card shadow-soft"
            />
          )}

          {currentCard ? (
            <AnimatePresence initial={false} custom={motionCustom}>
              <SwipeCard
                key={currentCard.id}
                card={currentCard}
                motionCustom={motionCustom}
                flipped={flipped}
                canGoPrevious={position > 0}
                canGoNext={position < total - 1}
                known={isKnownCurrent}
                fontFamily={fontFamily}
                fontSize={fontSize}
                onFlip={flip}
                onNavigate={go}
                onEdge={go}
                onToggleKnown={toggleKnown}
                onInteract={retireHint}
              />
            </AnimatePresence>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[1.75rem] border border-dashed border-border-strong p-8 text-center">
              <p className="text-[15px] font-semibold">No cards match this filter.</p>
              <p className="max-w-xs text-sm text-muted">
                {hideKnown
                  ? "Every card in this selection is marked known."
                  : "Try a different chapter."}
              </p>
              <Button variant="secondary" className="mt-2" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}

          <AnimatePresence>
            {showHint && (
              <motion.div
                key="gesture-hint"
                data-testid="gesture-hint"
                className="pointer-events-none absolute inset-x-0 bottom-14 z-10 flex justify-center px-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.35, duration: 0.3 } }}
                exit={{ opacity: 0, y: 6, transition: { duration: 0.18 } }}
              >
                <p className="flex items-center gap-2 rounded-full bg-foreground/90 py-2.5 pl-3 pr-4 text-[13px] font-medium text-background shadow-float">
                  <ChevronLeft
                    aria-hidden
                    className="hint-nudge h-4 w-4"
                    style={{ "--nudge": "-4px" } as CSSProperties}
                  />
                  Swipe to move
                  <ChevronRight aria-hidden className="hint-nudge -ml-1 h-4 w-4" />
                  <span aria-hidden className="mx-0.5 h-3.5 w-px bg-background/30" />
                  Tap to flip
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {showButtons ? (
          <nav
            aria-label="Card controls"
            data-testid="control-bar"
            className="mt-5 grid w-full max-w-[40rem] grid-cols-[1fr_auto_1fr] items-center gap-2 sm:mt-7 sm:gap-3"
          >
            <Button
              variant="secondary"
              size="lg"
              onClick={() => go(-1)}
              disabled={position <= 0 || !currentCard}
            >
              <ArrowLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={flip}
              disabled={!currentCard}
              className="min-w-[6.5rem] px-6 sm:min-w-32"
            >
              <RefreshCw className="h-4 w-4" />
              Flip
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => go(1)}
              disabled={position >= total - 1}
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </nav>
        ) : (
          // Gesture mode: no button bar taking space from the card, but the
          // same actions stay reachable by keyboard and assistive technology,
          // and become visible the moment one of them has focus.
          <div
            role="group"
            aria-label="Card controls"
            data-testid="gesture-mode-controls"
            className="sr-only focus-within:not-sr-only focus-within:mt-4 focus-within:flex focus-within:gap-2"
          >
            <Button variant="secondary" size="sm" onClick={() => go(-1)} disabled={position <= 0}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" onClick={flip} disabled={!currentCard}>
              Flip
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => go(1)}
              disabled={position >= total - 1}
            >
              Next
            </Button>
          </div>
        )}

        {/* Counts sit with the card and controls, so the group reads as one unit. */}
        <div className="mt-4 flex min-h-7 items-center justify-center gap-2.5 text-[13px] tabular-nums text-muted sm:mt-5">
          <span data-testid="card-counter" className="font-semibold text-foreground/80">
            {total > 0 ? position + 1 : 0} / {total}
          </span>
          <span aria-hidden className="h-1 w-1 rounded-full bg-border-strong" />
          <span>{knownSet.size} known</span>
          {showShortcutHint && (
            <span className="ml-4 hidden items-center gap-1.5 md:inline-flex">
              <kbd className="kbd">←</kbd>
              <kbd className="kbd">→</kbd>
              <span className="mr-2">move</span>
              <kbd className="kbd">Space</kbd>
              <span>flip</span>
            </span>
          )}
        </div>
      </main>

      <div aria-hidden className="safe-bottom shrink-0" />

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            className="fixed inset-x-0 z-30 mx-auto flex w-max max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-foreground py-2 pl-4 pr-2 text-sm font-medium text-background shadow-float"
            style={{ bottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + 4.25rem)" }}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
          >
            <span className="py-1">{toast.message}</span>
            {toast.restart && (
              <button
                type="button"
                onClick={() => {
                  restart();
                  setToast(null);
                }}
                className="rounded-full bg-background/15 px-3 py-1 text-sm font-semibold hover:bg-background/25"
              >
                Restart
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <FlashcardOptionsSheet
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        compact={compact}
        chapters={deck.chapters}
        totalCards={deck.cards.length}
        chapter={chapter}
        onChapterChange={setChapter}
        shuffle={shuffle}
        onShuffleChange={setShuffle}
        hideKnown={hideKnown}
        onHideKnownChange={setHideKnown}
        knownCount={knownSet.size}
        onRestart={() => {
          restart();
          setOptionsOpen(false);
        }}
        showControlMode={compact}
        controlMode={controlMode}
        onControlModeChange={setControlMode}
        showShortcuts={finePointer}
        font={font}
        onFontChange={setFont}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        onResetProgress={handleResetProgress}
        onExit={() => {
          setOptionsOpen(false);
          onExit();
        }}
      />
    </div>
  );
}
