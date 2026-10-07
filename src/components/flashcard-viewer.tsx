// The study screen.
//
// Started as CCNA Practice Labs' src/components/flashcards/flashcard-viewer.tsx.
// The study model is unchanged — chapter filter, hide-known, shuffle, restart,
// per-card "known" marks, reading options, progress — and so is what progress
// means. The screen around it is built to give the card the screen:
//
//   * Phone-sized (see COMPACT_QUERY): no header at all. The deck title is not
//     shown (it stays in the document as a visually hidden heading), and the
//     card's position — "13 ─── 884" — lives inside the card. Two small
//     controls float over the card's top-right corner: Full screen and Study
//     options. Everything secondary, including Back to your decks, is in the
//     Study options sheet.
//   * Tablet / desktop: the study desk. A slim top bar (back, the wordmark,
//     full screen, theme, a "Definitions first" pin, options), a deck panel (title, what is being
//     studied, "Card 3 of 5" with its progress, how many are known), then one
//     large card with the rest of the deck fanned beneath it, and a control
//     panel: Previous / Flip / Next with the keyboard hints. Here the card's
//     position is in the deck panel, so the card itself stays a clean card.
//   * Immersive ("Full screen"), any size: the app's own chrome goes — header,
//     title, hints — leaving the card and one floating Study options control.
//     Where the Fullscreen API is genuinely available (desktop, Android, iPad)
//     the browser's chrome goes too. An iPhone tab has no such API; there the
//     first entry offers, once, a pointer to Add to Home Screen, which is the
//     real way to lose the browser chrome on iPhone. Leave through Study
//     options, Escape, or the browser's own exit from full screen.
//   * Controls adapt to the layout (never to a user-agent string):
//       phone-sized  → gestures by default; Buttons mode puts Previous / Flip
//                      / Next in a bottom strip (portrait) or in rails at
//                      either side (landscape, where height is scarce)
//       larger       → buttons always; gestures still work on the card
//     In gesture mode the buttons stay in the accessibility tree and appear
//     when keyboard focus reaches them, so gestures are never the only way.
//   * Tap flips, swipes navigate with the card following the finger. See
//     swipe-card.tsx, which also explains the flip and navigation motion.
//   * Keyboard: ← → move, Space / Enter / ↑ / ↓ flip, K marks known, Escape
//     leaves immersive mode. Keys are left alone while a form control, player
//     or dialog has them, and whenever a modifier is held (Alt+← is Back).
//     A held key does not machine-gun: a held flip key flips once, and held
//     arrows step at a readable pace.
//
// Position and flip state live here, in React state, and are the only truth.
// The card's animations (swipe-card.tsx) follow that state and can be
// interrupted at any point without it being wrong: a card is keyed by its id,
// so pressing Next ten times moves exactly ten cards whatever is mid-flight.
//
// Rotating the device changes only layout: position, flip state and the scroll
// position inside the card all live in state that no layout change touches.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Maximize2,
  Pin,
  RefreshCw,
  SlidersHorizontal,
  SquarePlus,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Wordmark } from "@/components/ui/logo";
import { DoodleArrow, DoodleBook, HandNote } from "@/components/ui/decor";
import { ThemeToggle } from "@/components/theme-toggle";
import { SwipeCard, type CardMotion } from "@/components/swipe-card";
import { FlashcardOptionsSheet } from "@/components/flashcard-options-sheet";
import { HomeScreenHelp } from "@/components/home-screen-help";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import { FLASHCARD_FONTS } from "@/lib/fonts";
import { prewarmCardHtml } from "@/lib/flashcards/card-links";
import { recoverFocus } from "@/lib/input-modality";
import {
  enterBrowserFullscreen,
  exitBrowserFullscreen,
  fullscreenAvailable,
  fullscreenElement,
  homeScreenIsTheWayToFullscreen,
  onFullscreenChange,
  useInstalledDisplay,
} from "@/lib/display-mode";
import {
  COMPACT_QUERY,
  FINE_POINTER_QUERY,
  PHONE_LANDSCAPE_QUERY,
  useMediaQuery,
  usePrefersReducedMotion,
} from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { CardStage, KEY_REPEAT_INTERVAL_MS } from "@/lib/motion";
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

/** The sheets fanned beneath the card on the desk, top first. */
const DECK_STACK = [
  { tone: "paper-tan", transform: "translate(9px, -7px) rotate(2deg)" },
  { tone: "paper-mint", transform: "translate(-13px, 11px) rotate(-3.2deg)" },
  { tone: "paper-blue", transform: "translate(16px, 7px) rotate(4.5deg)" },
] as const;

/** One floating control: a 44px target around a quieter 36px disc. */
const FLOATING_BUTTON = 44;

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
  const studyDirection = useFlashcardPrefsStore((s) => s.studyDirection);
  const setStudyDirection = useFlashcardPrefsStore((s) => s.setStudyDirection);
  // The side a card opens on when it becomes the current card. Changing it
  // leaves the card already up as it is; the next card follows it.
  const backFirst = studyDirection === "back-first";
  const [position, setPosition] = useState(0);
  // `flipped` is which side is up (true = the back). `openedOnBack` is the
  // side the current card opened on, so "the answer is showing" stays right
  // whichever way round the reader is studying.
  const [flipped, setFlipped] = useState(backFirst);
  const [openedOnBack, setOpenedOnBack] = useState(backFirst);
  const answerUp = flipped !== openedOnBack;
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  // Where a swiped card was let go, so it leaves from there.
  const [releaseX, setReleaseX] = useState(0);
  // Counts card changes, so a card still leaving knows when it is overtaken.
  const [generation, setGeneration] = useState(0);
  // Phones: the card put beneath the top one by a drag (1 = next, -1 =
  // previous, 0 = none), and how far the drag has uncovered it.
  const [peek, setPeek] = useState<-1 | 0 | 1>(0);
  const reveal = useMotionValue(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [homeScreenTip, setHomeScreenTip] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const optionsTriggerRef = useRef<HTMLButtonElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  // True while this screen holds the browser's real full screen.
  const holdsFullscreen = useRef(false);
  // When a held arrow key last moved a card.
  const lastRepeatMove = useRef(0);

  const compact = useMediaQuery(COMPACT_QUERY);
  const landscape = useMediaQuery(PHONE_LANDSCAPE_QUERY);
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const reduced = usePrefersReducedMotion();
  const installed = useInstalledDisplay();

  const font = useFlashcardPrefsStore((s) => s.font);
  const fontSize = useFlashcardPrefsStore((s) => s.fontSize);
  const setFont = useFlashcardPrefsStore((s) => s.setFont);
  const setFontSize = useFlashcardPrefsStore((s) => s.setFontSize);
  const controlMode = useFlashcardPrefsStore((s) => s.controlMode);
  const setControlMode = useFlashcardPrefsStore((s) => s.setControlMode);
  const gestureHintSeen = useFlashcardPrefsStore((s) => s.gestureHintSeen);
  const markGestureHintSeen = useFlashcardPrefsStore((s) => s.markGestureHintSeen);
  const cardLinks = useFlashcardPrefsStore((s) => s.cardLinks);
  const setCardLinks = useFlashcardPrefsStore((s) => s.setCardLinks);
  const homeScreenTipSeen = useFlashcardPrefsStore((s) => s.homeScreenTipSeen);
  const markHomeScreenTipSeen = useFlashcardPrefsStore((s) => s.markHomeScreenTipSeen);
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
    openSide();
    setDirection(0);
    setGeneration((g) => g + 1);
    setPeek(0);
  }

  const total = order.length;
  const currentIndex = order[position];
  const currentCard: Flashcard | null = currentIndex !== undefined ? deck.cards[currentIndex] : null;
  const isKnownCurrent = currentCard ? knownSet.has(currentCard.id) : false;
  const remaining = total - position - 1;

  const phoneLandscape = compact && landscape;
  const buttonsMode = !compact || controlMode === "buttons";
  const showHeader = !compact && !immersive;
  // Controls floating over the card: phone-sized always, any size in immersive.
  const floating = compact || immersive;
  const floatingFullscreen = floating && !immersive;
  const controlsInset = floating ? (floatingFullscreen ? 2 : 1) * FLOATING_BUTTON + 12 : 0;
  const offerHomeScreen = homeScreenIsTheWayToFullscreen();

  const showHint = compact && controlMode === "gestures" && !gestureHintSeen && currentCard !== null;
  const showShortcutHint = finePointer && !compact;

  const motionCustom = useMemo<CardMotion>(
    () => ({ direction, width: cardWidth, reduced, offset: releaseX }),
    [direction, cardWidth, reduced, releaseX]
  );
  const cardStage = useMemo(
    () => ({ generation, motion: motionCustom, reveal }),
    [generation, motionCustom, reveal]
  );
  // Phones: the card beneath the top one while a drag uncovers it.
  const peekIndex = compact && peek !== 0 ? order[position + peek] : undefined;
  const peekCard: Flashcard | null = peekIndex !== undefined ? deck.cards[peekIndex] : null;
  // The desk layout: one landscape card with the rest of the deck beneath it.
  const desk = !compact && !immersive;
  const stackDepth = desk && currentCard ? Math.min(3, Math.max(0, remaining)) : 0;

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

  useEffect(() => {
    if (!homeScreenTip) return;
    const timer = window.setTimeout(() => setHomeScreenTip(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [homeScreenTip]);

  // The browser's full screen can end without us — Escape, a system back
  // gesture, the browser's own button. Immersive mode follows it out, so the
  // app never sits in a half state the reader did not choose.
  useEffect(
    () =>
      onFullscreenChange(() => {
        if (fullscreenElement()) {
          holdsFullscreen.current = true;
        } else if (holdsFullscreen.current) {
          holdsFullscreen.current = false;
          setImmersive(false);
        }
      }),
    []
  );

  // Leaving the deck gives the screen back.
  useEffect(() => () => exitBrowserFullscreen(), []);

  // Entering or leaving immersive mode removes the control that did it. A
  // keyboard user is moved to the control that now does the reverse; after a
  // tap, focus is just released (see input-modality.ts).
  const immersiveChanged = useRef(false);
  useEffect(() => {
    if (!immersiveChanged.current) {
      immersiveChanged.current = true;
      return;
    }
    // Focus is stranded when it is on nothing, on a removed control, or on a
    // control inside a dialog that is animating closed (Study options' own
    // Full screen / Exit full screen buttons).
    const active = document.activeElement;
    const stranded =
      !active || active === document.body || !active.isConnected || !!active.closest("[role='dialog']");
    if (!stranded) return;
    recoverFocus(
      immersive ? optionsTriggerRef.current : (fullscreenButtonRef.current ?? optionsTriggerRef.current)
    );
  }, [immersive]);

  // Render the neighbouring cards ahead of time (sanitize + link policy, and
  // start decoding their images) once the current move has settled, so the
  // next move never parses HTML in the middle of its animation.
  useEffect(() => {
    const neighbours = [order[position + 1], order[position - 1]]
      .filter((i): i is number => i !== undefined)
      .map((i) => deck.cards[i]);
    if (neighbours.length === 0) return;
    const run = () => {
      for (const card of neighbours) {
        prewarmCardHtml(card.front, cardLinks);
        prewarmCardHtml(card.back, cardLinks);
      }
    };
    const idle = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof idle.requestIdleCallback === "function") {
      const id = idle.requestIdleCallback(run, { timeout: 1000 });
      return () => idle.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(run, 450);
    return () => window.clearTimeout(timer);
  }, [order, position, deck.cards, cardLinks]);

  function go(step: 1 | -1, fromX = 0) {
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
    setReleaseX(fromX);
    setGeneration((g) => g + 1);
    setPosition(next);
    openSide();
    // The card beneath (if a drag put it there) is now the top card.
    setPeek(0);
    reveal.set(0);
    setAnnouncement(`Card ${next + 1} of ${total}`);
  }

  // Phones: put the card a drag is uncovering beneath the top card — at once,
  // before the top card moves off it, so the stage never shows bare.
  function peekBeneath(step: -1 | 0 | 1) {
    if (step === 0) reveal.set(0);
    flushSync(() => setPeek(step));
  }

  // A card becoming the current one opens on the side the study direction says.
  function openSide() {
    setFlipped(backFirst);
    setOpenedOnBack(backFirst);
  }

  function flip() {
    if (!currentCard) return;
    const next = !flipped;
    setFlipped(next);
    setAnnouncement(next !== openedOnBack ? "Showing answer" : "Showing question");
  }

  function changeStudyDirection(direction: typeof studyDirection) {
    if (direction === studyDirection) return;
    setStudyDirection(direction);
    setAnnouncement(
      direction === "back-first"
        ? "Definitions first, from the next card"
        : "Words first, from the next card"
    );
  }

  function toggleKnown() {
    if (!currentCard) return;
    markKnown(deck.slug, currentCard.id, !isKnownCurrent);
  }

  function restart() {
    setDirection(0);
    setReleaseX(0);
    setGeneration((g) => g + 1);
    setPeek(0);
    setPosition(0);
    openSide();
    if (shuffle) setShuffleNonce((n) => n + 1);
    if (total > 0) setAnnouncement(`Card 1 of ${total}`);
  }

  // Called from a click, so the Fullscreen request carries its user gesture.
  function enterImmersive() {
    setImmersive(true);
    setAnnouncement("Full screen. Study options has the way back.");
    if (fullscreenAvailable()) {
      enterBrowserFullscreen();
    } else if (offerHomeScreen && !homeScreenTipSeen) {
      // Said once per device, never again: it is a tip, not a nag.
      setHomeScreenTip(true);
      markHomeScreenTipSeen();
    }
  }

  function exitImmersive() {
    setImmersive(false);
    setHomeScreenTip(false);
    holdsFullscreen.current = false;
    exitBrowserFullscreen();
    setAnnouncement("Left full screen");
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
      if (optionsOpen || helpOpen || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && ownsKeyboard(target)) return;

      const onControl = !!target?.closest(
        "button, a[href], summary, [role='button'], [role='switch'], [role='menuitem']"
      );
      const inScrollingCard = !!target?.closest(".card-scroll");

      // A held key repeats some thirty times a second. Holding an arrow steps
      // through the deck at a pace the eye can follow; holding a flip or
      // known key acts once, rather than flickering back and forth.
      const heldMove = () => {
        if (!event.repeat) return true;
        const now = performance.now();
        if (now - lastRepeatMove.current < KEY_REPEAT_INTERVAL_MS) return false;
        lastRepeatMove.current = now;
        return true;
      };

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          if (heldMove()) go(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (heldMove()) go(-1);
          break;
        case "ArrowUp":
        case "ArrowDown":
          // A focused scrollable card uses these to scroll.
          if (onControl || inScrollingCard) return;
          event.preventDefault();
          if (!event.repeat) flip();
          break;
        case " ":
        case "Enter":
          // A focused button already acts on Space/Enter; flipping too would double up.
          if (onControl) return;
          event.preventDefault();
          if (!event.repeat) flip();
          break;
        case "k":
        case "K":
          if (!event.repeat) toggleKnown();
          break;
        case "Escape":
          if (!immersive) return;
          event.preventDefault();
          exitImmersive();
          break;
        default:
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsOpen, helpOpen, immersive, position, total, flipped, openedOnBack, backFirst, currentCard, isKnownCurrent]);

  const chapterName = deck.chapters.find((c) => c.id === chapter)?.name;
  const filterSummary = [
    chapter !== "all" ? chapterName : null,
    shuffle ? "Shuffled" : null,
    hideKnown ? "Hiding known" : null,
    backFirst ? "Definition first" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const cardControls = {
    canPrevious: position > 0 && !!currentCard,
    canFlip: !!currentCard,
    canNext: position < total - 1,
    onPrevious: () => go(-1),
    onFlip: flip,
    onNext: () => go(1),
  };

  return (
    <div
      className="study-shell mx-auto flex w-full flex-col"
      data-layout={compact ? "phone" : "wide"}
      data-immersive={immersive}
      data-orientation={phoneLandscape ? "landscape" : "portrait"}
    >
      {showHeader ? (
        <header className="safe-top mx-auto w-full max-w-[60rem] shrink-0">
          <div className="flex items-center gap-1 pb-2 sm:gap-2">
            <button
              type="button"
              onClick={onExit}
              aria-label="Back to your decks"
              className="-ml-1.5 inline-flex h-11 shrink-0 items-center gap-0.5 rounded-full pl-1.5 pr-2 text-sm font-medium text-muted transition-[background-color,color,transform] duration-150 hover:bg-control hover:text-foreground active:scale-95 sm:pr-3.5"
            >
              <ChevronLeft className="h-5 w-5" />
              <span className="hidden sm:inline">Decks</span>
            </button>

            <div className="flex min-w-0 flex-1 justify-center">
              <Wordmark compact />
            </div>

            <button
              ref={fullscreenButtonRef}
              type="button"
              onClick={enterImmersive}
              aria-label="Full screen"
              title="Full screen"
              className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-2.5 text-sm font-medium text-muted transition-[background-color,color,transform] duration-150 hover:bg-control hover:text-foreground active:scale-95"
            >
              <Maximize2 className="h-[18px] w-[18px]" />
            </button>
            <ThemeToggle className="h-11 w-11" />
            {/* Pins the definition as the side every new card opens on. */}
            <button
              type="button"
              onClick={() => changeStudyDirection(backFirst ? "front-first" : "back-first")}
              aria-pressed={backFirst}
              aria-label="Keep definitions first"
              title={
                backFirst
                  ? "Definitions first: new cards open on the definition. Click to open on the word again."
                  : "Keep definitions first: new cards open on the definition."
              }
              data-testid="pin-direction"
              className={cn(
                "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-2.5 text-sm font-medium transition-[background-color,color,transform] duration-150 hover:bg-control active:scale-95",
                backFirst ? "text-accent" : "text-muted hover:text-foreground"
              )}
            >
              <Pin className={cn("h-[18px] w-[18px]", backFirst && "fill-current")} />
              <span className="hidden md:inline">Definitions first</span>
            </button>
            <button
              ref={optionsTriggerRef}
              type="button"
              onClick={() => setOptionsOpen(true)}
              aria-label="Study options"
              aria-haspopup="dialog"
              aria-expanded={optionsOpen}
              className="-mr-1.5 inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-2.5 text-sm font-medium text-muted transition-[background-color,color,transform] duration-150 hover:bg-control hover:text-foreground active:scale-95 sm:mr-0 sm:px-3.5"
            >
              <SlidersHorizontal className="h-[18px] w-[18px]" />
              <span className="hidden sm:inline">Options</span>
            </button>
          </div>

          {/* The deck panel: what is being studied, and how far through it. */}
          <div className="panel mx-auto flex w-full max-w-[46rem] items-center gap-4 px-4 py-3 sm:px-6 sm:py-3.5">
            <DoodleBook className="hidden h-11 w-14 shrink-0 text-accent sm:block" />
            <div className="min-w-0 flex-1">
              <p className="eyebrow text-[0.66rem]">Studying</p>
              <h1
                className="mt-1 truncate font-display text-[1.3rem] font-bold leading-tight"
                title={deck.title}
              >
                {deck.title}
              </h1>
              <div className="study-deck-meta mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                <span className="shrink-0 tabular-nums">
                  {total} {total === 1 ? "card" : "cards"}
                </span>
                {filterSummary && (
                  <>
                    <span aria-hidden>•</span>
                    <button
                      type="button"
                      onClick={() => setOptionsOpen(true)}
                      className="min-w-0 truncate font-medium text-accent"
                    >
                      {filterSummary}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="w-36 shrink-0 sm:w-52" data-testid="deck-progress">
              <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
                {/* Read out from inside the card ("Card 3 of 5"), so not twice. */}
                <span aria-hidden className="font-medium">
                  {currentCard ? `Card ${position + 1} of ${total}` : "No cards"}
                </span>
                <span className="inline-flex items-center gap-1 text-[13px] text-muted">
                  <Star aria-hidden className="h-3.5 w-3.5 text-gold" />
                  <span>{knownSet.size} known</span>
                </span>
              </div>
              <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-background/60 ring-1 ring-panel-border">
                <div
                  className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out"
                  style={{ transform: `scaleX(${currentCard && total > 0 ? (position + 1) / total : 0})` }}
                />
              </div>
            </div>
          </div>
        </header>
      ) : (
        // Not shown, but still the page's heading for anyone navigating by them.
        <h1 className="sr-only">{deck.title}</h1>
      )}

      <main
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          !compact && "items-center justify-center",
          !compact && immersive && "pt-1"
        )}
      >
        <div
          className={cn(
            "relative flex min-h-0 w-full flex-1 justify-center",
            desk && "items-center py-5"
          )}
        >
          {desk && currentCard && (
            // Asides in the margin, where the window is wide enough for them.
            <>
              <div className="absolute right-[calc(50%+22.75rem)] top-[10%] hidden w-40 -rotate-6 flex-col items-end xl:flex">
                <DoodleArrow className="mr-6 h-7 w-14 text-hand opacity-70" />
                <HandNote className="mt-1 text-right">
                  {answerUp ? "Did you have it?" : "Think of the answer…"}
                </HandNote>
              </div>
              <div className="absolute left-[calc(50%+22.75rem)] top-[58%] hidden w-40 rotate-3 flex-col items-start xl:flex">
                <DoodleArrow flip className="ml-2 h-7 w-14 text-hand opacity-70" />
                <HandNote className="mt-1">
                  {answerUp ? "Flip back any time" : "Flip to see the answer"}
                </HandNote>
              </div>
            </>
          )}

          <div
            ref={stageRef}
            data-testid="study-stage"
            className={cn(
              "relative min-h-0 w-full flex-1",
              // A landscape flashcard, capped so lines stay readable; on a
              // short window it gives up height before it gives up width.
              desk && "aspect-[3/2] max-h-full max-w-[40rem]",
              !compact && immersive && "max-w-[60rem]",
              phoneLandscape && buttonsMode && "mx-16"
            )}
          >
            {/* The rest of the deck, fanned beneath the card: silhouettes
                only — as many as there are cards left, up to three. A sheet
                that runs out fades away rather than vanishing. */}
            <AnimatePresence initial={false}>
              {DECK_STACK.slice(0, stackDepth)
                .reverse()
                .map((sheet) => (
                  <motion.div
                    key={sheet.tone}
                    aria-hidden
                    data-testid="deck-stack"
                    className={cn("paper paper-flat absolute inset-0", sheet.tone)}
                    style={{ transform: sheet.transform }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  />
                ))}
            </AnimatePresence>

            {currentCard ? (
              <CardStage.Provider value={cardStage}>
              <AnimatePresence initial={false}>
                {peekCard && (
                  // Keyed like the card it will become, so a change promotes
                  // this very element to the top rather than re-rendering it.
                  <SwipeCard
                    key={peekCard.id}
                    under
                    card={peekCard}
                    flipped={backFirst}
                    position={position + peek + 1}
                    total={total}
                    canGoPrevious={position + peek > 0}
                    canGoNext={position + peek < total - 1}
                    known={knownSet.has(peekCard.id)}
                    fontFamily={fontFamily}
                    fontSize={fontSize}
                    linkMode={cardLinks}
                    compact={compact}
                    controlsInset={controlsInset}
                    showPosition={!desk}
                    onFlip={flip}
                    onNavigate={go}
                    onEdge={(step) => go(step)}
                    onToggleKnown={toggleKnown}
                    onInteract={retireHint}
                    onPeek={peekBeneath}
                  />
                )}
                <SwipeCard
                  key={currentCard.id}
                  card={currentCard}
                  flipped={flipped}
                  position={position + 1}
                  total={total}
                  canGoPrevious={position > 0}
                  canGoNext={position < total - 1}
                  known={isKnownCurrent}
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  linkMode={cardLinks}
                  compact={compact}
                  controlsInset={controlsInset}
                  showPosition={!desk}
                  onFlip={flip}
                  onNavigate={go}
                  onEdge={(step) => go(step)}
                  onToggleKnown={toggleKnown}
                  onInteract={retireHint}
                  onPeek={peekBeneath}
                />
              </AnimatePresence>
              </CardStage.Provider>
            ) : (
              <div className="panel absolute inset-0 flex flex-col items-center justify-center gap-3 border-dashed p-8 text-center">
                <p className="font-display text-xl font-bold">No cards match this filter.</p>
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

            {floating && (
              <div
                data-testid="floating-controls"
                className={cn("absolute z-20 flex", compact ? "right-1 top-2" : "right-3 top-4")}
              >
                {floatingFullscreen && (
                  <FloatingButton ref={fullscreenButtonRef} label="Full screen" onClick={enterImmersive}>
                    <Maximize2 className="h-4 w-4" />
                  </FloatingButton>
                )}
                <FloatingButton
                  ref={optionsTriggerRef}
                  label="Study options"
                  onClick={() => setOptionsOpen(true)}
                  expanded={optionsOpen}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </FloatingButton>
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

            <AnimatePresence>
              {toast && (
                <motion.div
                  key={toast.id}
                  role="status"
                  className="absolute inset-x-0 bottom-12 z-30 mx-auto flex w-max max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-foreground py-2 pl-4 pr-2 text-sm font-medium text-background shadow-float"
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
                      className="min-h-9 rounded-full bg-background/15 px-3 py-1 text-sm font-semibold hover:bg-background/25"
                    >
                      Restart
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {homeScreenTip && (
                <motion.div
                  key="home-screen-tip"
                  role="status"
                  data-testid="home-screen-tip"
                  className="absolute inset-x-2 bottom-11 z-30 mx-auto flex max-w-sm items-center gap-2 rounded-2xl bg-foreground py-2 pl-3.5 pr-1.5 text-[13px] leading-snug text-background shadow-float"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.25 } }}
                  exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
                >
                  <SquarePlus aria-hidden className="h-4 w-4 shrink-0 opacity-80" />
                  <span className="min-w-0 flex-1">
                    For the most screen space on iPhone, add Flashcards for All to your Home Screen.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setHomeScreenTip(false);
                      setHelpOpen(true);
                    }}
                    className="min-h-11 shrink-0 rounded-xl px-2.5 font-semibold underline-offset-2 hover:underline"
                  >
                    How
                  </button>
                  <button
                    type="button"
                    onClick={() => setHomeScreenTip(false)}
                    aria-label="Dismiss tip"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl opacity-80 hover:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {phoneLandscape && buttonsMode && (
            // Landscape has width to spare and no height: Previous under the
            // left thumb, Flip and Next under the right.
            <nav
              aria-label="Card controls"
              data-testid="control-bar"
              data-variant="rails"
              className="pointer-events-none absolute inset-0 flex justify-between"
            >
              <div className="pointer-events-auto flex w-14 flex-col">
                <RailButton label="Previous" onClick={cardControls.onPrevious} disabled={!cardControls.canPrevious}>
                  <ArrowLeft className="h-5 w-5" />
                </RailButton>
              </div>
              <div className="pointer-events-auto flex w-14 flex-col gap-2">
                <RailButton label="Flip" primary onClick={cardControls.onFlip} disabled={!cardControls.canFlip}>
                  <RefreshCw className="h-5 w-5" />
                </RailButton>
                <RailButton label="Next" onClick={cardControls.onNext} disabled={!cardControls.canNext}>
                  <ArrowRight className="h-5 w-5" />
                </RailButton>
              </div>
            </nav>
          )}
        </div>

        {buttonsMode && !phoneLandscape ? (
          <div
            className={cn(
              "mx-auto w-full shrink-0",
              compact ? "mt-2.5" : "panel max-w-[46rem] px-3.5 py-3.5 sm:px-5",
              !compact && immersive && "mt-4"
            )}
          >
            <nav
              aria-label="Card controls"
              data-testid="control-bar"
              data-variant={compact ? "strip" : "bar"}
              className={cn(
                "grid w-full items-center",
                compact ? "grid-cols-[1fr_auto_1fr] gap-2" : "grid-cols-[1fr_1.4fr_1fr] gap-2.5 sm:gap-3.5"
              )}
            >
              <Button variant="secondary" size="lg" onClick={cardControls.onPrevious} disabled={!cardControls.canPrevious}>
                <ArrowLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={cardControls.onFlip}
                disabled={!cardControls.canFlip}
                className={cn("font-display text-[1.05rem]", compact && "min-w-[7rem] px-6")}
              >
                <RefreshCw className="h-[18px] w-[18px]" />
                Flip
              </Button>
              <Button variant="secondary" size="lg" onClick={cardControls.onNext} disabled={!cardControls.canNext}>
                Next
                <ArrowRight className="h-4 w-4" />
              </Button>
            </nav>

            {showHeader && showShortcutHint && (
              <div className="mt-3 hidden items-center justify-center gap-1.5 text-[13px] text-muted md:flex">
                <kbd className="kbd">←</kbd>
                <kbd className="kbd">→</kbd>
                <span>move</span>
                <span aria-hidden className="mx-2 h-3.5 w-px bg-border-strong" />
                <kbd className="kbd">Space</kbd>
                <span>flip</span>
                <span aria-hidden className="mx-2 h-3.5 w-px bg-border-strong" />
                <kbd className="kbd">K</kbd>
                <span>mark known</span>
              </div>
            )}
          </div>
        ) : !buttonsMode ? (
          // Gesture mode: no button bar taking space from the card, but the
          // same actions stay reachable by keyboard and assistive technology,
          // and become visible the moment one of them has focus.
          <div
            role="group"
            aria-label="Card controls"
            data-testid="gesture-mode-controls"
            className="sr-only focus-within:not-sr-only focus-within:mt-2 focus-within:flex focus-within:justify-center focus-within:gap-2"
          >
            <Button variant="secondary" onClick={cardControls.onPrevious} disabled={!cardControls.canPrevious}>
              Previous
            </Button>
            <Button variant="secondary" onClick={cardControls.onFlip} disabled={!cardControls.canFlip}>
              Flip
            </Button>
            <Button variant="secondary" onClick={cardControls.onNext} disabled={!cardControls.canNext}>
              Next
            </Button>
          </div>
        ) : null}

        {showHeader && (
          <p className="study-tip panel mx-auto mt-3 flex w-full max-w-[40rem] shrink-0 items-center gap-3 rounded-2xl px-4 py-2.5 text-sm text-muted">
            <Lightbulb aria-hidden className="h-[18px] w-[18px] shrink-0 text-gold" />
            {answerUp
              ? "Knew it? Mark it known on the card, then move on to the next one."
              : "Take your time. Read the card, think of the answer, then turn it over."}
          </p>
        )}
      </main>

      {showHeader && <div aria-hidden className="safe-bottom shrink-0" />}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

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
        studyDirection={studyDirection}
        onStudyDirectionChange={changeStudyDirection}
        immersive={immersive}
        onToggleImmersive={() => {
          setOptionsOpen(false);
          if (immersive) exitImmersive();
          else enterImmersive();
        }}
        offerHomeScreen={offerHomeScreen}
        installed={installed}
        onHomeScreenHelp={() => {
          setOptionsOpen(false);
          setHelpOpen(true);
        }}
        showControlMode={compact}
        controlMode={controlMode}
        onControlModeChange={setControlMode}
        cardLinks={cardLinks}
        onCardLinksChange={setCardLinks}
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

      <HomeScreenHelp
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        fallbackFocus={optionsTriggerRef}
      />
    </div>
  );
}

function FloatingButton({
  label,
  onClick,
  expanded,
  children,
  ref,
}: {
  label: string;
  onClick: () => void;
  expanded?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      aria-expanded={expanded}
      className="group flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted/85 shadow-soft transition-[background-color,transform] duration-150 group-hover:bg-surface-muted group-active:scale-90">
        {children}
      </span>
    </button>
  );
}

function RailButton({
  label,
  onClick,
  disabled,
  primary,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      onClick={onClick}
      disabled={disabled}
      className="h-auto min-h-11 w-full flex-1 flex-col gap-1 rounded-2xl px-0 text-[11px]"
    >
      {children}
      {label}
    </Button>
  );
}
