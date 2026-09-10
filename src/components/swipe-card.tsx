// One flashcard on the study stage: gestures, the flip, and both faces.
//
// Gesture model (thresholds and their reasoning live in src/lib/gestures.ts):
//
//   drag horizontally  → the card follows the finger; release past the
//                        distance or with a flick to go next (left) or
//                        previous (right). A tentative drag springs back.
//   tap                → flip. Taps are clicks, so assistive technology that
//                        activates by click flips the card too.
//   swipe up or down   → flip, but only while the visible face fits. When a
//                        face scrolls, vertical movement belongs to the scroll.
//
// Any movement past TAP_SLOP swallows the click that follows, so a swipe can
// never also flip. Buttons, links and audio inside the card are left alone.
//
// touch-action: a touch's allowed browser behaviour is resolved from the
// touched element up to the nearest scroll container — not up to the card. The
// card's own scroll area (and any table or code block, which scroll sideways)
// is such a container, so each carries the card's touch-action too. Without
// that, the browser starts a pan inside the card and cancels the swipe.
//
// Motion: navigation flies the card out in the direction it was thrown and
// brings the next one in from the opposite side; the flip is a 3D turn with
// both faces backface-hidden. With reduced motion both become short fades.

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useTransform,
  type MotionValue,
  type Variants,
} from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeCardHtml } from "@/lib/flashcards/sanitize";
import {
  TAP_SLOP,
  VelocityTracker,
  classifyRelease,
  lockAxis,
  rubberBand,
  type AxisLock,
} from "@/lib/gestures";
import type { Flashcard } from "@/lib/flashcards/types";

/** Passed through AnimatePresence so an exiting card knows which way to leave. */
export interface CardMotion {
  /** 1 = moving to the next card, -1 = previous, 0 = no spatial meaning (filter, restart). */
  direction: -1 | 0 | 1;
  width: number;
  reduced: boolean;
}

type TouchAction = "none" | "pan-y";

const cardVariants: Variants = {
  enter: ({ direction, width, reduced }: CardMotion) =>
    reduced || direction === 0
      ? { x: 0, opacity: 0, scale: reduced ? 1 : 0.985 }
      : { x: direction * Math.min(width * 0.6, 280), opacity: 0, scale: 0.97 },
  center: ({ reduced }: CardMotion) => ({
    x: 0,
    opacity: 1,
    scale: 1,
    transition: reduced
      ? { duration: 0.15 }
      : {
          x: { type: "spring", stiffness: 420, damping: 38 },
          opacity: { duration: 0.2 },
          scale: { duration: 0.28 },
        },
  }),
  exit: ({ direction, width, reduced }: CardMotion) =>
    reduced || direction === 0
      ? { opacity: 0, transition: { duration: 0.12 } }
      : {
          x: -direction * (width + 80),
          opacity: 0,
          transition: {
            x: { duration: 0.3, ease: [0.25, 0.6, 0.35, 1] },
            opacity: { duration: 0.3, ease: "easeIn" },
          },
        },
};

/**
 * Elements inside a card that keep their own pointer behaviour.
 *
 * Controls (buttons, links, media) keep both drags and clicks. A table or code
 * block that scrolls sideways keeps drags — horizontal movement on it scrolls
 * it — but a tap on it is still a tap, and flips the card like anywhere else.
 */
function isOwnInteraction(target: EventTarget | null, includeScrollers = true): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      "button, a[href], audio, video, input, select, textarea, label, summary, [contenteditable], [data-no-gesture]"
    )
  ) {
    return true;
  }
  if (!includeScrollers) return false;
  const scroller = target.closest(".anki-card-content table, .anki-card-content pre");
  return !!scroller && scroller.scrollWidth > scroller.clientWidth + 1;
}

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  axis: AxisLock;
  moved: boolean;
}

export interface SwipeCardProps {
  card: Flashcard;
  motionCustom: CardMotion;
  flipped: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  known: boolean;
  fontFamily: string;
  fontSize: number;
  onFlip: () => void;
  onNavigate: (direction: 1 | -1) => void;
  onEdge: (direction: 1 | -1) => void;
  onToggleKnown: () => void;
  /** Any deliberate gesture (tap or swipe) — used to retire the first-run hint. */
  onInteract: () => void;
}

export function SwipeCard({
  card,
  motionCustom,
  flipped,
  canGoPrevious,
  canGoNext,
  known,
  fontFamily,
  fontSize,
  onFlip,
  onNavigate,
  onEdge,
  onToggleKnown,
  onInteract,
}: SwipeCardProps) {
  const { reduced, width } = motionCustom;
  const isPresent = useIsPresent();

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, (v) => (reduced ? 0 : Math.max(-6, Math.min(6, v / 34))));
  const rotateX = useTransform(y, (v) => (reduced ? 0 : Math.max(-9, Math.min(9, -v / 4))));

  const [overflow, setOverflow] = useState({ front: false, back: false });
  const verticalFlip = !(flipped ? overflow.back : overflow.front);
  // Everything is ours while the face fits; vertical panning is the browser's
  // (native scrolling) once it does not.
  const touchAction: TouchAction = verticalFlip ? "none" : "pan-y";

  const gesture = useRef<GestureState | null>(null);
  const [tracker] = useState(() => new VelocityTracker());
  const suppressClick = useRef(false);

  const handleOverflow = useCallback((side: "front" | "back", value: boolean) => {
    setOverflow((current) => (current[side] === value ? current : { ...current, [side]: value }));
  }, []);

  function settle(value: MotionValue<number>, velocity = 0) {
    if (reduced) animate(value, 0, { duration: 0.12 });
    else animate(value, 0, { type: "spring", stiffness: 520, damping: 36, velocity: velocity * 1000 });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isPresent || gesture.current || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (isOwnInteraction(event.target)) return;

    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      moved: false,
    };
    suppressClick.current = false;
    tracker.reset(event.clientX, event.clientY, performance.now());
    x.stop();
    y.stop();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;

    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    tracker.add(event.clientX, event.clientY, performance.now());
    if (!g.moved && Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;

    if (g.axis === null) {
      const axis = lockAxis(dx, dy);
      g.axis = axis === "y" && !verticalFlip ? "none" : axis;
      if (g.axis === "x" || g.axis === "y") {
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is an optimisation (keeps events coming off-card); not required.
        }
      }
    }

    if (g.axis === "x") {
      const allowed = dx < 0 ? canGoNext : canGoPrevious;
      x.set(allowed ? dx : rubberBand(dx));
    } else if (g.axis === "y") {
      y.set(rubberBand(dy, 40));
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    gesture.current = null;

    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    tracker.add(event.clientX, event.clientY, performance.now());
    if (g.moved || Math.hypot(dx, dy) > TAP_SLOP) suppressClick.current = true;

    const { vx, vy } = tracker.velocity();
    const outcome = classifyRelease({
      axis: g.axis,
      dx,
      dy,
      vx,
      vy,
      cardWidth: width,
      canGoPrevious,
      canGoNext,
      verticalFlip,
    });

    if (outcome === "next" || outcome === "previous") {
      onInteract();
      onNavigate(outcome === "next" ? 1 : -1);
      settle(y);
      return;
    }
    if (outcome === "flip") {
      onInteract();
      onFlip();
    }
    if (outcome === "edge") onEdge(dx < 0 ? 1 : -1);
    settle(x, vx);
    settle(y, vy);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    gesture.current = null;
    // The browser took the gesture over (usually a scroll): no click follows,
    // and nothing here should act on it.
    suppressClick.current = false;
    settle(x);
    settle(y);
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!isPresent || isOwnInteraction(event.target, false)) return;
    onInteract();
    onFlip();
  }

  const faceProps = {
    card,
    known,
    reduced,
    fontFamily,
    fontSize,
    touchAction,
    onToggleKnown,
    onOverflowChange: handleOverflow,
  };

  return (
    <motion.div
      data-testid="card-surface"
      custom={motionCustom}
      variants={cardVariants}
      initial="enter"
      animate="center"
      exit="exit"
      className="absolute inset-0 cursor-pointer select-none"
      style={{
        x,
        y,
        rotate,
        rotateX,
        transformPerspective: 1200,
        touchAction,
        pointerEvents: isPresent ? "auto" : "none",
        zIndex: isPresent ? 2 : 1,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
    >
      <motion.div
        data-testid="card-flipper"
        data-flipped={flipped}
        data-motion={reduced ? "reduced" : "full"}
        className="relative h-full w-full"
        style={{ transformStyle: "preserve-3d", transformPerspective: 1800 }}
        initial={false}
        animate={{ rotateY: !reduced && flipped ? 180 : 0 }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 230, damping: 27 }}
      >
        <CardFace side="front" hidden={flipped} {...faceProps} />
        <CardFace side="back" hidden={!flipped} {...faceProps} />
      </motion.div>
    </motion.div>
  );
}

type Fade = "none" | "top" | "bottom" | "both";

function CardFace({
  side,
  card,
  hidden,
  known,
  reduced,
  fontFamily,
  fontSize,
  touchAction,
  onToggleKnown,
  onOverflowChange,
}: {
  side: "front" | "back";
  card: Flashcard;
  hidden: boolean;
  known: boolean;
  reduced: boolean;
  fontFamily: string;
  fontSize: number;
  touchAction: TouchAction;
  onToggleKnown: () => void;
  onOverflowChange: (side: "front" | "back", overflowing: boolean) => void;
}) {
  const isBack = side === "back";
  const html = isBack ? card.back : card.front;

  // Sanitized again here, not just at import: a deck stored by an earlier
  // version of the app was cleaned by that version's rules, and this is the
  // last point before the HTML reaches the DOM. `allowBareMedia: false`
  // because bundled media has already been resolved to blob: URLs by now, so
  // anything still carrying a plain src would be a network request the deck
  // author chose rather than one the deck's own files justify.
  const safeHtml = useMemo(() => sanitizeCardHtml(html, { allowBareMedia: false }), [html]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<Fade>("none");

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const overflowing = el.scrollHeight - el.clientHeight > 2;
      const atTop = el.scrollTop <= 1;
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      setFade(!overflowing ? "none" : atTop ? "bottom" : atEnd ? "top" : "both");
      onOverflowChange(side, overflowing);

      // Tables and code blocks are scroll containers of their own (they scroll
      // sideways when too wide), so they also end a touch's touch-action
      // chain. One that overflows keeps native panning; one that fits behaves
      // like the rest of the card.
      for (const block of el.querySelectorAll<HTMLElement>(
        ".anki-card-content table, .anki-card-content pre"
      )) {
        block.style.touchAction =
          block.scrollWidth > block.clientWidth + 1 ? "pan-x pan-y" : touchAction;
      }
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    // Images change the height when they finish loading; load does not bubble.
    el.addEventListener("load", update, true);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("load", update, true);
      observer?.disconnect();
    };
  }, [safeHtml, fontSize, fontFamily, side, touchAction, onOverflowChange]);

  const scrollable = fade !== "none" && !hidden;

  return (
    <motion.div
      className={cn(
        "flashcard-face absolute inset-0 flex flex-col overflow-hidden rounded-[1.75rem] border border-card-border shadow-card",
        isBack ? "bg-card-back" : "bg-card"
      )}
      style={{ rotateY: isBack && !reduced ? 180 : 0, pointerEvents: hidden ? "none" : undefined }}
      initial={false}
      animate={{ opacity: reduced && hidden ? 0 : 1 }}
      transition={{ duration: reduced ? 0.15 : 0 }}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      {isBack && <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-accent/70" />}

      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 sm:px-6 sm:pt-4">
        <span
          className={cn(
            "pl-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
            isBack ? "text-accent" : "text-muted"
          )}
        >
          {isBack ? "Answer" : "Question"}
        </span>
        <KnownToggle known={known} onToggle={onToggleKnown} />
      </div>

      <div
        ref={scrollRef}
        data-fade={fade}
        tabIndex={scrollable ? 0 : undefined}
        role={scrollable ? "region" : undefined}
        aria-label={scrollable ? `${isBack ? "Answer" : "Question"}, scrollable` : undefined}
        className="card-scroll min-h-0 flex-1 px-6 py-3 focus-visible:outline-offset-[-4px] sm:px-10 sm:py-4"
        style={{ touchAction }}
      >
        <div
          className="anki-card-content"
          style={{ fontFamily, fontSize: `${fontSize}px` }}
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>

      <div className="flex min-h-10 items-center justify-center px-6 pb-3 sm:pb-4">
        <span className="truncate text-xs text-muted" title={card.chapter}>
          {card.chapter}
        </span>
      </div>
    </motion.div>
  );
}

function KnownToggle({ known, onToggle }: { known: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={known}
      className={cn(
        // The ::before extends the hit area to ~48px without enlarging the chip.
        "relative inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
        "before:absolute before:-inset-2 before:content-[''] transition-[background-color,border-color,color,transform] duration-150 active:scale-95",
        known
          ? "border-transparent bg-accent-soft text-accent"
          : "border-border text-muted hover:border-border-strong hover:text-foreground"
      )}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={known ? 3 : 2.25} />
      {known ? "Known" : "Mark known"}
    </button>
  );
}
