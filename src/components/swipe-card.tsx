// One flashcard on the study stage: gestures, the flip, both faces, and where
// the card sits in the run.
//
// Gesture model (thresholds and their reasoning live in src/lib/gestures.ts):
//
//   drag horizontally  → the card follows the finger; release past the
//                        distance or with a flick to go next (left) or
//                        previous (right). A tentative drag springs back.
//   tap                → flip. Taps are clicks, so assistive technology that
//                        activates by click flips the card too.
//   vertical movement  → never the card's. It scrolls a long face natively.
//
// Any movement past TAP_SLOP swallows the click that follows — in the capture
// phase, before anything inside the card sees it — so a swipe can never also
// flip, and a swipe that starts on a card link can never follow the link.
// Buttons, media and form controls inside the card keep their own taps and
// drags. A link keeps its tap (when card links are enabled; otherwise it is
// plain text, see card-links.ts) but not drags: a swipe that starts on a link
// is still a swipe, which is what a card that is mostly one big link needs.
//
// touch-action: a touch's allowed browser behaviour is resolved from the
// touched element up to the nearest scroll container — not up to the card. The
// card's own scroll area (and any table or code block, which scroll sideways)
// is such a container, so each carries `pan-y` too: vertical panning is the
// browser's everywhere, horizontal movement is the card's everywhere except on
// a table or code block that actually overflows sideways.
//
// The card is cardstock (.paper in styles.css): cream, with a printed inset
// rule, a little thickness and a cast shadow. The front is cream and the back
// a cooler, mint-tinted paper, so which side is up is plain at a glance. A
// short question or term is set as display type, as large as the card allows
// (src/lib/flashcards/card-layout.ts); anything longer reads as a document.
//
// Three movements, deliberately unlike each other (timings: src/lib/motion.ts):
//
// The flip — the same card, turned over. The card's shell (paper, rule, shadow
// and the position footer) is one element that stays mounted for the life of
// the card; only which face is painted changes. A flip turns the shell edge-on
// about its vertical axis (rotateY 0 → 90°) under CSS perspective, so the
// stiff card narrows to a line, swaps the painted face at the instant the
// shell is invisible, and turns it back (-90° → 0). A shadow passes over the
// card as it turns away from the light. Both faces stay in the DOM throughout,
// so a flip is never a remount, a layout change or a size change, and there is
// never a frame with mirrored text, both faces, or neither.
//
// It replaced a classic two-face 3D flip (preserve-3d, both faces rotated,
// backface-visibility: hidden). In WebKit — the engine behind every iPhone
// browser, Chrome included — that construction is fragile: under Playwright's
// WebKit the back face painted mirrored on top of the front even at rest. And
// framer-motion writes `transform: none` for an all-default transform, so every
// flip began by creating a brand-new 3D layer, which is a classic WebKit
// single-frame flash. Here nothing depends on backface-visibility, and the
// shell's transform is always a 3D transform (never "none"), so its layer
// exists before a flip starts instead of being created on its first frame.
//
// Next and Previous — a different card. The card on top is moved a short way
// aside, turning a few degrees and fading as it goes, while the card beneath
// comes forward from the stack and settles. Next moves the card aside to the
// right, Previous to the left, so the direction of travel through the deck
// can be read from the motion alone. It is a hand moving a card off a stack,
// not a slide show: nothing crosses the screen. A swiped card continues the
// way the finger threw it (left for next, right for previous) from where it
// was let go.
//
// With reduced motion there is no turn and no travel: the face swaps in place
// and cards cross-fade.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { Check } from "lucide-react";
import { Ornament, Sparkle } from "@/components/ui/decor";
import { cn } from "@/lib/utils";
import { renderCardHtml, type CardLinkMode } from "@/lib/flashcards/card-links";
import {
  briefFontSize,
  displayFit,
  displayFontSize,
  splitAnswer,
} from "@/lib/flashcards/card-layout";
import { NAV_TILT, TURN_IN, TURN_OUT, cardVariants, type CardMotion } from "@/lib/motion";

export type { CardMotion };
import {
  TAP_SLOP,
  VelocityTracker,
  classifyRelease,
  lockAxis,
  rubberBand,
  type AxisLock,
} from "@/lib/gestures";
import type { Flashcard } from "@/lib/flashcards/types";

type Side = "front" | "back";

/** Controls inside a card that keep their own taps and drags. */
const OWN_CONTROLS =
  "button, audio, video, input, select, textarea, label, summary, [contenteditable], [data-no-gesture]";

/**
 * A drag that starts here is not a card swipe: a control, or a table or code
 * block that actually scrolls sideways (horizontal movement scrolls it).
 * Links are deliberately absent — see the header comment.
 */
function ownsDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(OWN_CONTROLS)) return true;
  const scroller = target.closest(".anki-card-content table, .anki-card-content pre");
  return !!scroller && scroller.scrollWidth > scroller.clientWidth + 1;
}

/** A tap here is not a flip: a control, or a live card link. */
function ownsTap(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`${OWN_CONTROLS}, a[href]`);
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
  /** 1-based position in the current run, and the run's length. */
  position: number;
  total: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  known: boolean;
  fontFamily: string;
  fontSize: number;
  linkMode: CardLinkMode;
  /** Phone-sized layout: tighter corners and padding. */
  compact: boolean;
  /** Space kept clear at the right of each face's header for controls floating over the card. */
  controlsInset: number;
  /** Show "13 ─── 884" inside the card. Off where the screen shows it elsewhere; still read out. */
  showPosition: boolean;
  onFlip: () => void;
  onNavigate: (direction: 1 | -1, fromX: number) => void;
  onEdge: (direction: 1 | -1) => void;
  onToggleKnown: () => void;
  /** Any deliberate gesture (tap or swipe) — used to retire the first-run hint. */
  onInteract: () => void;
}

export function SwipeCard({
  card,
  motionCustom,
  flipped,
  position,
  total,
  canGoPrevious,
  canGoNext,
  known,
  fontFamily,
  fontSize,
  linkMode,
  compact,
  controlsInset,
  showPosition,
  onFlip,
  onNavigate,
  onEdge,
  onToggleKnown,
  onInteract,
}: SwipeCardProps) {
  const { reduced, width } = motionCustom;
  const isPresent = useIsPresent();

  const x = useMotionValue(0);
  // A dragged card leans the way it is pulled, like a card held by one edge.
  const rotate = useMotionValue(0);

  const gesture = useRef<GestureState | null>(null);
  const [tracker] = useState(() => new VelocityTracker());
  // A click that arrives before this time follows a drag and is swallowed.
  const suppressClickUntil = useRef(0);

  // ------------------------------------------------------------- the flip --
  const turn = useMotionValue(0);
  const shellTransform = useTransform(turn, (deg) => `perspective(1100px) rotateY(${deg}deg)`);
  // Shade on the card's face, deepest when it is edge-on to the light.
  const sheen = useTransform(turn, (deg) => Math.min(1, Math.abs(deg) / 90) * 0.75);
  const shellRef = useRef<HTMLDivElement>(null);
  const [painted, setPainted] = useState<Side>(flipped ? "back" : "front");
  const paintedRef = useRef<Side>(painted);

  useEffect(() => {
    const target: Side = flipped ? "back" : "front";
    const paint = (side: Side) => {
      paintedRef.current = side;
      // Written to the DOM directly as well as through state, so the swap lands
      // in the same frame as the jump to the far edge below rather than
      // whenever React next commits.
      if (shellRef.current) shellRef.current.dataset.painted = side;
      setPainted(side);
    };

    if (reduced) {
      turn.jump(0);
      if (paintedRef.current !== target) paint(target);
      return;
    }

    if (paintedRef.current === target) {
      // Flipped back before the face swapped: turn back to flat.
      if (turn.get() === 0) return;
      const back = animate(turn, 0, TURN_OUT);
      return () => back.stop();
    }

    let active = true;
    let controls: ReturnType<typeof animate> | null = null;
    const current = turn.get();
    const edge = current < 0 ? -90 : 90;
    const remaining = Math.max(0.25, 1 - Math.abs(current) / 90);
    controls = animate(turn, edge, { ...TURN_IN, duration: TURN_IN.duration * remaining });
    controls.then(() => {
      if (!active) return;
      paint(target);
      turn.jump(-edge);
      controls = animate(turn, 0, TURN_OUT);
    });
    return () => {
      active = false;
      controls?.stop();
    };
  }, [flipped, reduced, turn]);

  // ------------------------------------------------------------- gestures --
  function springBack(value: MotionValue<number>, velocity = 0) {
    if (reduced) {
      animate(value, 0, { duration: 0.12 });
      animate(rotate, 0, { duration: 0.12 });
      return;
    }
    animate(value, 0, { type: "spring", stiffness: 520, damping: 36, velocity: velocity * 1000 });
    animate(rotate, 0, { type: "spring", stiffness: 520, damping: 36 });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    suppressClickUntil.current = 0;
    if (!isPresent || gesture.current || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (ownsDrag(event.target)) return;

    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      moved: false,
    };
    tracker.reset(event.clientX, event.clientY, performance.now());
    x.stop();
    rotate.stop();
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
      // Vertical movement belongs to scrolling, never to the card.
      g.axis = axis === "y" ? "none" : axis;
      if (g.axis === "x") {
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is an optimisation (keeps events coming off-card); not required.
        }
      }
    }

    if (g.axis === "x") {
      const allowed = dx < 0 ? canGoNext : canGoPrevious;
      const travel = allowed ? dx : rubberBand(dx);
      x.set(travel);
      if (!reduced && width > 0) rotate.set((travel / width) * NAV_TILT * 1.6);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    gesture.current = null;

    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    tracker.add(event.clientX, event.clientY, performance.now());
    if (g.moved || Math.hypot(dx, dy) > TAP_SLOP) {
      suppressClickUntil.current = performance.now() + 600;
    }

    const { vx } = tracker.velocity();
    const outcome = classifyRelease({
      axis: g.axis,
      dx,
      vx,
      cardWidth: width,
      canGoPrevious,
      canGoNext,
    });

    if (outcome === "next" || outcome === "previous") {
      // The card leaves from where the finger let go; the next one comes
      // forward from the stack beneath it.
      onInteract();
      onNavigate(outcome === "next" ? 1 : -1, x.get());
      return;
    }
    if (outcome === "edge") onEdge(dx < 0 ? 1 : -1);
    springBack(x, vx);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    gesture.current = null;
    // The browser took the gesture over (usually a scroll): no click follows,
    // and nothing here should act on it.
    suppressClickUntil.current = 0;
    springBack(x);
  }

  function handleClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    // `detail` is 0 for clicks synthesised by the keyboard or assistive
    // technology; those never follow a drag.
    if (event.detail === 0 || performance.now() >= suppressClickUntil.current) return;
    suppressClickUntil.current = 0;
    // Cancels a card link's navigation as well as the flip.
    event.preventDefault();
    event.stopPropagation();
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isPresent || ownsTap(event.target)) return;
    onInteract();
    onFlip();
  }

  // A mouse drag on a link or an image would otherwise start the browser's
  // own drag-and-drop, which cancels the pointer stream mid-swipe.
  function handleDragStart(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  const faceProps = {
    card,
    known,
    fontFamily,
    fontSize,
    linkMode,
    compact,
    controlsInset,
    onToggleKnown,
  };

  return (
    <motion.div
      data-testid="card-surface"
      custom={motionCustom}
      variants={cardVariants}
      initial="enter"
      animate="center"
      exit="exit"
      className="card-surface absolute inset-0 cursor-pointer select-none"
      style={{
        x,
        rotate,
        touchAction: "pan-y",
        pointerEvents: isPresent ? "auto" : "none",
        // A card being moved aside stays on top of the one coming forward.
        zIndex: isPresent ? 2 : 3,
      }}
      aria-hidden={isPresent ? undefined : true}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
      onClick={handleClick}
      onDragStartCapture={handleDragStart}
    >
      <motion.div
        ref={shellRef}
        data-testid="card-flipper"
        data-flipped={flipped}
        data-painted={painted}
        data-motion={reduced ? "reduced" : "full"}
        className="card-shell paper flex h-full w-full flex-col overflow-hidden"
        style={{
          transform: shellTransform,
          ...(compact ? ({ "--radius-card": "1rem", "--paper-inset": "0.4rem" } as CSSProperties) : null),
        }}
      >
        <div className="relative min-h-0 flex-1">
          <CardFace side="front" hidden={flipped} {...faceProps} />
          <CardFace side="back" hidden={!flipped} {...faceProps} />
        </div>
        <CardPosition
          position={position}
          total={total}
          present={isPresent}
          compact={compact}
          visible={showPosition}
        />
        <motion.span aria-hidden className="card-sheen" style={{ opacity: sheen }} />
      </motion.div>
    </motion.div>
  );
}

/**
 * "13 ─────── 884": the current card on the left, the run's length on the
 * right, a hairline of progress between. Screen readers get "Card 13 of 884".
 */
function CardPosition({
  position,
  total,
  present,
  compact,
  visible,
}: {
  position: number;
  total: number;
  present: boolean;
  compact: boolean;
  visible: boolean;
}) {
  const progress = total > 0 ? Math.min(1, position / total) : 0;
  return (
    <div
      data-testid={present ? "card-position" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-3 text-[12px] font-semibold tabular-nums leading-none text-muted",
        compact ? "px-5 pb-3.5 pt-1" : "px-8 pb-5 pt-1.5",
        // Where the deck header already shows the position, the card stays a
        // clean card; the count is still here for assistive technology.
        !visible && "sr-only"
      )}
    >
      <span className="sr-only">
        Card {position} of {total}
      </span>
      <span aria-hidden data-testid={present ? "card-position-current" : undefined} className="text-left">
        {position}
      </span>
      <span aria-hidden className="h-[3px] min-w-6 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <span
          className="block h-full w-full origin-left rounded-full bg-accent/55"
          style={{ transform: `scaleX(${progress})` }}
        />
      </span>
      <span aria-hidden data-testid={present ? "card-position-total" : undefined} className="text-right">
        {total}
      </span>
    </div>
  );
}

type Fade = "none" | "top" | "bottom" | "both";

function CardFace({
  side,
  card,
  hidden,
  known,
  fontFamily,
  fontSize,
  linkMode,
  compact,
  controlsInset,
  onToggleKnown,
}: {
  side: Side;
  card: Flashcard;
  hidden: boolean;
  known: boolean;
  fontFamily: string;
  fontSize: number;
  linkMode: CardLinkMode;
  compact: boolean;
  controlsInset: number;
  onToggleKnown: () => void;
}) {
  const isBack = side === "back";
  const html = isBack ? card.back : card.front;

  // Sanitized again here, not just at import — a deck stored by an earlier
  // version of the app was cleaned by that version's rules, and this is the
  // last point before the HTML reaches the DOM — then the card-link policy.
  // Cached, and prewarmed for neighbouring cards by the viewer. The back is
  // then given its title / rule / answer structure where its HTML has one.
  const safeHtml = useMemo(() => {
    const rendered = renderCardHtml(html, linkMode);
    return isBack ? splitAnswer(rendered) : rendered;
  }, [html, linkMode, isBack]);

  // A short term or question is set as display type: the front as large as
  // the card allows, the back more quietly. Longer faces keep the reader's
  // chosen size.
  const fit = useMemo(() => displayFit(html), [html]);
  const display = !isBack && fit !== null;
  const contentFontSize = fit
    ? displayFontSize(fit, fontSize, isBack ? 2.1 : 6.5)
    : briefFontSize(html, fontSize);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<Fade>("none");

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const overflowing = el.scrollHeight - el.clientHeight > 2;
    const atTop = el.scrollTop <= 1;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    setFade(!overflowing ? "none" : atTop ? "bottom" : atEnd ? "top" : "both");

    // Tables and code blocks are scroll containers of their own (they scroll
    // sideways when too wide), so they also end a touch's touch-action chain.
    // One that overflows keeps native panning both ways; one that fits
    // behaves like the rest of the card.
    for (const block of el.querySelectorAll<HTMLElement>(
      ".anki-card-content table, .anki-card-content pre"
    )) {
      block.style.touchAction = block.scrollWidth > block.clientWidth + 1 ? "pan-x pan-y" : "pan-y";
    }
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Images change the height when they finish loading; load does not bubble.
    el.addEventListener("load", measure, true);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("load", measure, true);
      observer?.disconnect();
    };
  }, [safeHtml, fontSize, fontFamily, measure]);

  const scrollable = fade !== "none" && !hidden;

  return (
    <div
      data-face={side}
      className="flashcard-face absolute inset-0 flex flex-col"
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <div
        className={cn(
          "flex min-h-11 items-center gap-2",
          compact ? "pl-5 pr-4 pt-3" : "px-8 pt-5"
        )}
        style={controlsInset > 0 ? { paddingRight: controlsInset } : undefined}
      >
        <span
          className={cn(
            "shrink-0 pl-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
            isBack ? "text-accent" : "text-muted"
          )}
        >
          {isBack ? "Answer" : "Question"}
        </span>
        {!compact && (
          <span className="min-w-0 truncate text-xs text-muted" title={card.chapter}>
            {card.chapter}
          </span>
        )}
        <span className="ml-auto" />
        <KnownToggle known={known} onToggle={onToggleKnown} />
      </div>

      <div
        ref={scrollRef}
        data-fade={fade}
        tabIndex={scrollable ? 0 : undefined}
        role={scrollable ? "region" : undefined}
        aria-label={scrollable ? `${isBack ? "Answer" : "Question"}, scrollable` : undefined}
        className={cn(
          "card-scroll min-h-0 flex-1 focus-visible:outline-offset-[-4px]",
          compact ? "px-6 py-2" : "px-12 py-3"
        )}
        style={{ touchAction: "pan-y" }}
      >
        <div
          className={cn("anki-card-content", display && "card-display")}
          style={{ fontFamily, fontSize: contentFontSize }}
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
        {display && <Ornament className="card-display-rule" />}
      </div>
      {display && (
        // The small gold stars printed in the corners of a term card.
        <>
          <Sparkle className="absolute left-[7%] top-[24%] h-3.5 w-3.5 text-[#c79a45]" />
          <Sparkle className="absolute right-[8%] top-[22%] h-5 w-5 text-[#c79a45]" />
          <Sparkle className="absolute bottom-[12%] left-[9%] h-4 w-4 text-[#c79a45]" />
        </>
      )}
    </div>
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
        "relative z-[1] inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
        "before:absolute before:-inset-2 before:content-[''] transition-[background-color,border-color,color,transform] duration-150 active:scale-95",
        known
          ? "border-transparent bg-accent-soft text-accent"
          : "border-border-strong/45 text-muted hover:border-border-strong hover:text-foreground"
      )}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={known ? 3 : 2.25} />
      {known ? "Known" : "Mark known"}
    </button>
  );
}
