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
// Three movements, deliberately unlike each other (timings and poses:
// src/lib/motion.ts). Each card on the stage drives its own motion explicitly
// rather than through mount/unmount variants, so what is on screen is always
// a continuation of what was on screen the frame before.
//
// The flip — the same card, turned over. It is a real two-sided card: the
// front and back are both mounted for the life of the card, back to back in
// one preserve-3d container (the back pre-turned 180°, both with
// backface-visibility: hidden), and the flip rotates that container 0 → 180°
// under perspective set on its parent. The card passes through edge-on and
// never changes size, never fades, never swaps DOM content. A faint shade
// crosses the paper as it turns away from the light.
//
// WebKit (every iPhone browser) has historically been unreliable about
// backface-visibility, so it is not trusted alone: the side turned away is
// also marked data-painted / visibility: hidden from the very frame the turn
// passes edge-on — written straight to the DOM from the angle's own change
// event, not on a later React commit. Nothing that flattens 3D (overflow,
// opacity, filters) sits on the preserve-3d container itself, and its
// transform is always a 3D transform (never "none"), so its compositing layer
// exists before a flip starts rather than being created on the first frame.
//
// Next and Previous — a different card. The incoming card is mounted already
// solid, just behind and beneath the outgoing one; the outgoing card is moved
// a short way aside (right for Next, left for Previous), turning a few degrees
// and staying fully solid while it moves — a translucent card would show the
// next card's text through its own. Only once it is aside does it go: first
// its printing fades off the still-solid paper, then the blank paper dissolves
// over a card that is by then in place, so two texts are never legible over
// each other. Both cards move together for the whole change, so there is never
// a frame without a card on the stage. A
// swiped card is not snapped back first: it continues from where the finger
// let go, at the lean it had, the way it was thrown. A card still leaving when
// the reader moves on again leaves at once, so the stage never holds more than
// the card leaving and the card arriving.
//
// On a phone (the compact layout) Next and Previous are a deck held in the
// hand instead. The card a drag will uncover is put beneath the top card as
// the drag starts — mounted, printed, in place — and the top card slides off
// it: left for Next (uncovering the next card's right edge first), right for
// Previous. Let go past the threshold and the top card carries on off the
// side from where it was released, at the speed it was released; the card
// beneath is then the top card — the same element, promoted, never re-rendered
// into place. Let go short and the top card eases back over it, and it goes.
// Buttons and keys make the same slide from rest. Nothing fades; the stage's
// edge clips the card that has left. The flip also eases longer into its last
// few degrees there, its new side's printing resolving from a hair lighter
// and lower (MOBILE_FLIP, MOBILE_RESOLVE in src/lib/motion.ts). Wider screens
// are untouched.
//
// With reduced motion there is no turn and no travel: the side shown swaps in
// place, and a changed card appears beneath the old one as that fades.

import {
  useCallback,
  useContext,
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
  PresenceContext,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  usePresence,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "framer-motion";
import { Check } from "lucide-react";
import { Ornament, Sparkle } from "@/components/ui/decor";
import { cn } from "@/lib/utils";
import { animateKnownMark, finishMotion } from "@/lib/gsap-motion";
import { renderCardHtml, type CardLinkMode } from "@/lib/flashcards/card-links";
import {
  briefFontSize,
  displayFit,
  displayFontSize,
  splitAnswer,
} from "@/lib/flashcards/card-layout";
import {
  CardStage,
  DRAG_TILT,
  FLIP,
  MOBILE_FLIP,
  MOBILE_RESOLVE,
  NAV,
  REVEAL_SPAN,
  RESTING,
  SLIDE_RETURN,
  SLIDE_SETTLE,
  SUPERSEDED,
  enterFrom,
  exitTo,
  slideLean,
  slideOff,
  underPose,
  type CardMotion,
  type Pose,
} from "@/lib/motion";

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
  /**
   * Phones: this is the card beneath the top one, uncovered as the top card is
   * dragged off. It stays put, takes no input, and becomes the top card — the
   * same element, never re-rendered into place — when the change happens.
   */
  under?: boolean;
  /**
   * Phones: the top card asks for the card that its drag is uncovering to be
   * put beneath it (1 = next, -1 = previous, 0 = none).
   */
  onPeek?: (direction: -1 | 0 | 1) => void;
}

export function SwipeCard({
  card,
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
  under = false,
  onPeek,
}: SwipeCardProps) {
  const stage = useContext(CardStage);
  const { reduced, width } = stage.motion;
  const [isPresent, safeToRemove] = usePresence();
  // False only for the card shown when the screen opens: it is simply there.
  const appearsInPlace = useContext(PresenceContext)?.initial === false;
  // Phones: the hand deck (see the header comment). Wider screens keep the
  // desk's movements.
  const deck = compact;
  // The top card on the stage, the one that is read and handled.
  const onTop = isPresent && !under;

  // ----------------------------------------------- where the card sits --
  // Starts where it enters from — set before its first paint, so there is no
  // frame of it at rest before it moves. On a phone a new card starts beneath
  // the one leaving, a hair down, and stays there while it is uncovered.
  const [start] = useState<Pose>(() =>
    appearsInPlace
      ? RESTING
      : under
        ? underPose(stage.reveal.get(), reduced)
        : !deck
          ? enterFrom(stage.motion)
          : reduced || stage.motion.direction === 0
            ? RESTING
            : underPose(0)
  );
  const x = useMotionValue(start.x);
  const y = useMotionValue(start.y);
  // A dragged card leans the way it is pulled, like a card held by one edge.
  const rotate = useMotionValue(start.rotate);
  const scale = useMotionValue(start.scale);
  const opacity = useMotionValue(start.opacity);
  const ink = useMotionValue(start.ink);
  // Phones only: a flip's new side's printing, 1 = not yet resolved into place
  // (MOBILE_RESOLVE), 0 = at rest. Always 0 on wider screens, and on a card
  // change: the card beneath is printed and complete before it is uncovered.
  const settles = compact && !reduced;
  const unresolved = useMotionValue(0);
  const printOpacity = useTransform<number, number>(
    [ink, unresolved],
    ([i, u]) => i * (1 - (1 - MOBILE_RESOLVE.opacity) * u)
  );
  const printLift = useTransform(unresolved, (u) => u * MOBILE_RESOLVE.lift);

  // The movement in progress. Each new one replaces it; `run` tells a
  // superseded movement's completion from the current one's.
  const moving = useRef<AnimationPlaybackControls[]>([]);
  const run = useRef(0);
  const exitGeneration = useRef<number | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const overtaken = useRef(false);

  const stopMoving = useCallback(() => {
    for (const controls of moving.current) controls.stop();
    moving.current = [];
  }, []);

  const moveTo = useCallback(
    (
      pose: Partial<Record<keyof Pose, number | (number | null)[]>>,
      transition: object & Partial<Record<keyof Pose, object>>,
      then?: () => void
    ) => {
      stopMoving();
      const id = ++run.current;
      const values = { x, y, rotate, scale, opacity, ink } as const;
      const all: AnimationPlaybackControls[] = [];
      for (const key of Object.keys(values) as (keyof Pose)[]) {
        const to = pose[key];
        const value = values[key];
        if (to === undefined) continue;
        if (Array.isArray(to)) {
          // Keyframes; null is "from wherever it is now".
          const frames = to.map((v) => v ?? value.get());
          all.push(animate(value, frames, transition[key] ?? transition));
        } else if (value.get() !== to) {
          all.push(animate(value, to, transition[key] ?? transition));
        }
      }
      moving.current = all;
      Promise.all(all).then(() => {
        if (id === run.current) then?.();
      });
    },
    [ink, opacity, rotate, scale, stopMoving, x, y]
  );

  // How fast a swiped card was moving when it was let go (px/ms), so a
  // committed swipe continues at that speed rather than starting over.
  const releaseVelocity = useRef(0);
  // Phones: which card is beneath, as last asked of the stage, and which
  // return to centre is the latest (a new drag supersedes it).
  const peeking = useRef<-1 | 0 | 1>(0);
  const returning = useRef(0);

  useEffect(() => {
    // Whatever this card last asked to have beneath it belongs to its last
    // turn on top; the stage has cleared it since.
    peeking.current = 0;
    if (isPresent && under) {
      // Beneath the top card: it stays where it is. Only being uncovered
      // (below) brings it up, a hair. A card still sliding off when it is
      // wanted beneath again (swiped away, then straight back) slides back
      // in under the top card rather than leaving its side of the stage bare.
      exitGeneration.current = null;
      overtaken.current = false;
      if (surfaceRef.current) surfaceRef.current.style.visibility = "";
      if (x.get() !== 0 || rotate.get() !== 0 || opacity.get() !== 1 || ink.get() !== 1) {
        moveTo({ ...underPose(stage.reveal.get(), reduced) }, SLIDE_SETTLE);
      }
      return;
    }
    if (isPresent) {
      // Arriving, promoted from beneath, or coming back after starting to
      // leave (Next, then Previous straight away): settle into place from
      // wherever it is now.
      exitGeneration.current = null;
      overtaken.current = false;
      if (surfaceRef.current) surfaceRef.current.style.visibility = "";
      const atRest =
        x.get() === 0 &&
        y.get() === 0 &&
        rotate.get() === 0 &&
        scale.get() === 1 &&
        opacity.get() === 1 &&
        ink.get() === 1;
      if (!atRest) moveTo(RESTING, deck ? SLIDE_SETTLE : NAV);
      return;
    }
    if (under) {
      // A card beneath that is no longer wanted (the drag went back, or the
      // other way): the top card covers it, so it simply goes.
      stopMoving();
      if (surfaceRef.current) surfaceRef.current.style.visibility = "hidden";
      safeToRemove?.();
      return;
    }
    // Leaving: from exactly where it is — mid-drag, mid-arrival or at rest.
    exitGeneration.current = stage.generation;
    if (deck) {
      // Phones: slid off the deck, the way it was pushed or thrown.
      const { pose, transition } = slideOff(stage.motion, releaseVelocity.current);
      moveTo(pose, transition, () => safeToRemove?.());
      return;
    }
    const { transition, ...target } = exitTo(stage.motion);
    moveTo(target, transition, () => safeToRemove?.());
    // Only presence (and promotion from beneath) starts a movement; the
    // stage's later changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent, under]);

  // Phones: the top card tells the card beneath how far it is uncovered, and
  // the card beneath comes up that much — from a hair down to level.
  useMotionValueEvent(x, "change", (offset) => {
    if (!deck || !onTop || width <= 0) return;
    stage.reveal.set(Math.min(1, Math.abs(offset) / (width * REVEAL_SPAN)));
  });
  useMotionValueEvent(stage.reveal, "change", (reveal) => {
    if (!isPresent || !under) return;
    const pose = underPose(reveal, reduced);
    y.set(pose.y);
    scale.set(pose.scale);
  });

  useEffect(() => {
    // Overtaken while still leaving: go now, so cards never pile up. The
    // stage only removes leaving cards once the last of them has finished, so
    // a card that has gone is also taken out of rendering until then.
    // Overtaken twice — presses faster than any card could be read — it goes
    // at once, so no more than three are ever drawn (arriving, leaving, and
    // this one fading under them).
    if (isPresent || exitGeneration.current === null) return;
    if (stage.generation === exitGeneration.current) return;
    const twice = overtaken.current;
    overtaken.current = true;
    exitGeneration.current = stage.generation;
    const gone = () => {
      if (surfaceRef.current) surfaceRef.current.style.visibility = "hidden";
      safeToRemove?.();
    };
    if (twice) {
      stopMoving();
      run.current++;
      gone();
      return;
    }
    moveTo({ opacity: 0 }, SUPERSEDED, gone);
  }, [isPresent, moveTo, safeToRemove, stage.generation, stopMoving]);

  useEffect(() => stopMoving, [stopMoving]);

  const gesture = useRef<GestureState | null>(null);
  const [tracker] = useState(() => new VelocityTracker());
  // A click that arrives before this time follows a drag and is swallowed.
  const suppressClickUntil = useRef(0);

  // ------------------------------------------------------------- the flip --
  const turn = useMotionValue(flipped && !reduced ? 180 : 0);
  // Always a 3D transform, never "none" (see the header comment).
  const flipTransform = useTransform(turn, (deg) => `rotateY(${deg}deg)`);
  // A faint shade on the paper, deepest edge-on to the light.
  const shade = useTransform(turn, (deg) => Math.abs(Math.sin((deg * Math.PI) / 180)) * 0.6);
  const flipperRef = useRef<HTMLDivElement>(null);
  const [painted, setPainted] = useState<Side>(flipped ? "back" : "front");
  const paintedRef = useRef<Side>(painted);

  // When the turn in progress will finish (performance.now() time).
  const turnEnds = useRef(0);

  const paint = useCallback((side: Side) => {
    if (paintedRef.current === side) return false;
    paintedRef.current = side;
    // Straight to the DOM as well as through state, so the side turned away is
    // hidden in the same frame the turn passes edge-on, not on a later commit.
    if (flipperRef.current) flipperRef.current.dataset.painted = side;
    setPainted(side);
    return true;
  }, []);

  useMotionValueEvent(turn, "change", (deg) => {
    const changed = paint(Math.cos((deg * Math.PI) / 180) >= 0 ? "front" : "back");
    // Phones: the side coming up is printed a hair unresolved from the moment
    // it is edge-on (unseen), and resolves over the turn's last moments.
    const left = (turnEnds.current - performance.now()) / 1000;
    if (changed && settles && left > 0) {
      unresolved.jump(1);
      animate(unresolved, 0, {
        ...MOBILE_RESOLVE,
        delay: Math.max(0, left - MOBILE_RESOLVE.duration),
      });
    }
  });

  const wasReduced = useRef(reduced);
  useEffect(() => {
    const target = flipped ? 180 : 0;
    if (reduced) {
      // No turn: the shown side simply swaps.
      turn.jump(0);
      paint(flipped ? "back" : "front");
      wasReduced.current = true;
      return;
    }
    if (wasReduced.current) {
      // Motion was just allowed again: take up the current side without a turn.
      wasReduced.current = false;
      turn.jump(target);
      return;
    }
    const from = turn.get();
    if (from === target) return;
    // Turned back part-way through: the rest of the way, in proportion.
    const share = Math.max(0.4, Math.abs(target - from) / 180);
    const timing = compact ? MOBILE_FLIP : FLIP;
    const duration = timing.duration * share;
    turnEnds.current = performance.now() + duration * 1000;
    const controls = animate(turn, target, { ...timing, duration });
    return () => controls.stop();
    // `compact` is read when a turn starts; a resize mid-turn need not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, reduced, turn, paint]);

  // ------------------------------------------------------------- gestures --

  function peek(direction: -1 | 0 | 1) {
    if (peeking.current === direction) return;
    peeking.current = direction;
    onPeek?.(direction);
  }

  function springBack(velocity = 0) {
    let back: AnimationPlaybackControls[];
    if (reduced) {
      back = [animate(x, 0, { duration: 0.12 }), animate(rotate, 0, { duration: 0.12 })];
    } else if (deck) {
      // Eased out, no bounce; the card beneath is covered again.
      back = [animate(x, 0, SLIDE_RETURN), animate(rotate, 0, SLIDE_RETURN)];
    } else {
      // Critically damped: the card settles back, it does not bounce.
      back = [
        animate(x, 0, { type: "spring", stiffness: 380, damping: 40, velocity: velocity * 1000 }),
        animate(rotate, 0, { type: "spring", stiffness: 380, damping: 40 }),
      ];
    }
    if (!deck) return;
    // Covered again: the card beneath is no longer needed — unless a new drag
    // has taken the card up again in the meantime.
    const id = ++returning.current;
    Promise.all(back).then(() => {
      if (id === returning.current && !gesture.current) peek(0);
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    suppressClickUntil.current = 0;
    if (!onTop || gesture.current || !event.isPrimary) return;
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
    returning.current++;
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
      if (deck && travel !== 0) {
        // The card this drag uncovers goes beneath before the top card moves
        // off it, so no frame shows the stage bare. Past either end of the
        // deck, the one card there is still beneath.
        const toward = travel < 0 ? 1 : -1;
        const exists = (d: -1 | 1) => (d === 1 ? canGoNext : canGoPrevious);
        const away = -toward as -1 | 1;
        peek(exists(toward) ? toward : exists(away) ? away : 0);
      }
      x.set(travel);
      if (reduced || width <= 0) {
        // No lean.
      } else if (deck) {
        rotate.set(slideLean(travel, width));
      } else {
        rotate.set((travel / width) * DRAG_TILT);
      }
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
      // No spring back to centre: the card leaves from where the finger let
      // go, at the speed it was let go, and the next one comes forward from
      // the stack beneath it (on a phone: is simply there, uncovered).
      releaseVelocity.current = vx;
      onInteract();
      onNavigate(outcome === "next" ? 1 : -1, x.get());
      return;
    }
    if (outcome === "edge") onEdge(dx < 0 ? 1 : -1);
    springBack(vx);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    gesture.current = null;
    // The browser took the gesture over (usually a scroll): no click follows,
    // and nothing here should act on it.
    suppressClickUntil.current = 0;
    springBack();
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
    if (!onTop || ownsTap(event.target)) return;
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

  const sideProps = {
    position,
    total,
    present: onTop,
    compact,
    showPosition,
    shade,
    printOpacity,
    printLift,
    faceProps,
  };

  return (
    <motion.div
      ref={surfaceRef}
      // The card beneath is not yet the card: it is found by its own name.
      data-testid={under ? "card-under" : "card-surface"}
      data-deck={deck ? (under ? "under" : isPresent ? "top" : "leaving") : undefined}
      className="card-surface absolute inset-0 cursor-pointer select-none"
      style={{
        x,
        y,
        rotate,
        scale,
        opacity,
        touchAction: "pan-y",
        pointerEvents: onTop ? "auto" : "none",
        // A card being moved aside stays on top of the one coming forward;
        // the card beneath, beneath both.
        zIndex: under ? 1 : isPresent ? 2 : 3,
      }}
      aria-hidden={onTop ? undefined : true}
      inert={under || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
      onClick={handleClick}
      onDragStartCapture={handleDragStart}
    >
      {/* Perspective lives on the parent of the turning card, which itself is
          never transformed, so the 3D context starts here and nothing above
          it can flatten the turn. */}
      <div
        className="absolute inset-0"
        style={{ perspective: `${Math.round(Math.max(1000, width * 2.5))}px` }}
      >
        <motion.div
          ref={flipperRef}
          data-testid={under ? "card-under-flipper" : "card-flipper"}
          data-flipped={flipped}
          data-painted={painted}
          data-motion={reduced ? "reduced" : "full"}
          className="card-flipper relative h-full w-full"
          style={{
            transform: flipTransform,
            ...(compact ? ({ "--radius-card": "1rem", "--paper-inset": "0.4rem" } as CSSProperties) : null),
          }}
        >
          <CardSide side="front" hidden={flipped} turned={false} {...sideProps} />
          {/* Pre-turned to face away; with reduced motion the card never
              turns, so neither does its back. */}
          <CardSide side="back" hidden={!flipped} turned={!reduced} {...sideProps} />
        </motion.div>
      </div>
    </motion.div>
  );
}

type FaceProps = Omit<Parameters<typeof CardFace>[0], "side" | "hidden">;

/** One side of the card: its own paper, its face, its position footer. */
function CardSide({
  side,
  hidden,
  turned,
  position,
  total,
  present,
  compact,
  showPosition,
  shade,
  printOpacity,
  printLift,
  faceProps,
}: {
  side: Side;
  hidden: boolean;
  turned: boolean;
  position: number;
  total: number;
  present: boolean;
  compact: boolean;
  showPosition: boolean;
  shade: MotionValue<number>;
  printOpacity: MotionValue<number>;
  printLift: MotionValue<number>;
  faceProps: FaceProps;
}) {
  return (
    <div
      data-side={side}
      aria-hidden={hidden || undefined}
      className={cn(
        "card-side paper absolute inset-0 flex flex-col overflow-hidden",
        side === "back" && "paper-back"
      )}
      style={{ transform: turned ? "rotateY(180deg)" : "rotateY(0deg)" }}
    >
      {/* What is printed on the paper; a leaving card loses it before its
          paper, and on a phone a new side's printing resolves into place. */}
      <motion.div className="flex min-h-0 flex-1 flex-col" style={{ opacity: printOpacity, y: printLift }}>
        <div className="relative min-h-0 flex-1">
          <CardFace side={side} hidden={hidden} {...faceProps} />
        </div>
        <CardPosition
          position={position}
          total={total}
          // Only the side that is up names itself, so the position is found once.
          present={present && !hidden}
          compact={compact}
          visible={showPosition}
        />
      </motion.div>
      <motion.span aria-hidden className="card-sheen" style={{ opacity: shade }} />
    </div>
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
      <span
        aria-hidden
        data-progress-track
        className="h-[3px] min-w-6 flex-1 overflow-hidden rounded-full bg-surface-muted"
      >
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
  // The check is set like a marker when the card is marked or unmarked —
  // only on that change, never when a card arrives already known.
  const markRef = useRef<HTMLSpanElement>(null);
  const wasKnown = useRef(known);
  useEffect(() => {
    if (wasKnown.current === known) return;
    wasKnown.current = known;
    const motion = animateKnownMark(markRef.current);
    return () => {
      finishMotion(motion);
    };
  }, [known]);

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
      <span ref={markRef} data-testid="known-mark" className="inline-flex">
        <Check className="h-3.5 w-3.5" strokeWidth={known ? 3 : 2.25} />
      </span>
      {known ? "Known" : "Mark known"}
    </button>
  );
}
