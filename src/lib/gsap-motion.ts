// The finishing touches: a handful of short GSAP animations that confirm a
// change, mark progress, or reward finishing a deck. Nothing here touches the
// card itself — its flip, drag and deck movement belong to framer-motion
// (see motion.ts and swipe-card.tsx) and stay there.
//
// Rules every function here keeps:
//   * transform and opacity only, and props cleared at the end, so nothing is
//     left holding a transform once it is at rest;
//   * brief (well under half a second), except the 100% sequence (~1.3s);
//   * never loops, never repeats on its own, never delays input;
//   * under prefers-reduced-motion, does nothing and returns null. The markup
//     each one animates is already in its resting, final state without it.
//
// Each returns its tween or timeline (or null), so the caller can kill it
// when the thing it animates goes away or is overtaken.

import { gsap } from "gsap";
import { REDUCED_MOTION_QUERY } from "@/lib/use-media-query";

type Target = Element | null | undefined;
export type Motion = gsap.core.Animation | null;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

const live = (...targets: Target[]) => !reducedMotion() && targets.every(Boolean);

/**
 * Ends an animation at once, at its resting state (props cleared): for when
 * what it animates changes again, or goes away, before it is done.
 */
export function finishMotion(motion: Motion) {
  motion?.progress(1).kill();
}

/**
 * A marker set: the Known check, the Definitions-first pin.
 * 0.96 → 1.05 → 1 with a degree of turn, in 160ms. No bounce.
 */
export function animateKnownMark(el: Target): Motion {
  if (!live(el)) return null;
  return gsap
    .timeline({ onComplete: () => gsap.set(el!, { clearProps: "transform" }) })
    .fromTo(el!, { scale: 0.96, rotation: -1.5 }, { scale: 1.05, rotation: 0, duration: 0.08, ease: "power2.out" })
    .to(el!, { scale: 1, duration: 0.08, ease: "power1.inOut" });
}

/** A progress line reaching 25, 50 or 75%: it thickens a touch and settles, 220ms. */
export function animateProgressMilestone(track: Target): Motion {
  if (!live(track)) return null;
  return gsap
    .timeline({ onComplete: () => gsap.set(track!, { clearProps: "transform" }) })
    .fromTo(track!, { scaleY: 1 }, { scaleY: 1.6, duration: 0.11, ease: "power1.out" })
    .to(track!, { scaleY: 1, duration: 0.11, ease: "power1.in" });
}

/** Study direction changed: the chosen option's arrow slides the last few px into place. */
export function animateStudyDirectionChange(arrow: Target): Motion {
  if (!live(arrow)) return null;
  return gsap.fromTo(
    arrow!,
    { x: -5, opacity: 0.4 },
    { x: 0, opacity: 1, duration: 0.22, ease: "power2.out", clearProps: "transform,opacity" }
  );
}

/** A deck arriving in the library after it was imported. */
export function animateDeckImport(tile: Target): Motion {
  if (!live(tile)) return null;
  return gsap.fromTo(
    tile!,
    { y: 8, opacity: 0.94, scale: 0.99 },
    { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: "power2.out", clearProps: "transform,opacity" }
  );
}

let entrancePlayed = false;

/**
 * The home page's first appearance: its few main blocks, in order, each a
 * few px up into place, 80ms apart. Once per page load — coming back from a
 * deck, or any re-render, does not replay it.
 */
export function animateHomepageEntrance(elements: Element[]): Motion {
  if (entrancePlayed) return null;
  entrancePlayed = true;
  if (elements.length === 0 || reducedMotion()) return null;
  return gsap.from(elements, {
    y: 8,
    opacity: 0.94,
    duration: 0.45,
    ease: "power2.out",
    stagger: 0.08,
    clearProps: "transform,opacity",
  });
}

/** Tests only: lets the entrance play again. */
export function resetHomepageEntrance() {
  entrancePlayed = false;
}

/**
 * The last card finished: the deck settles a little (and stays settled while
 * the completion panel is up), and the panel rises the last few px into place.
 */
export function animateDeckComplete({ deck, panel }: { deck: Target; panel: Target }): Motion {
  if (!live(deck, panel)) return null;
  return gsap
    .timeline()
    .to(deck!, { scale: 0.985, y: 4, duration: 0.55, ease: "power2.out" }, 0)
    .fromTo(
      panel!,
      { y: 10, opacity: 0.95 },
      { y: 0, opacity: 1, duration: 0.5, ease: "power2.out", clearProps: "transform,opacity" },
      0.08
    );
}

/** The panel is dismissed: the deck comes back up to rest. */
export function releaseDeck(deck: Target): Motion {
  if (!deck) return null;
  if (reducedMotion()) {
    gsap.set(deck, { clearProps: "transform" });
    return null;
  }
  return gsap.to(deck, { scale: 1, y: 0, duration: 0.25, ease: "power2.out", clearProps: "transform" });
}

/**
 * Every card known. Over ~1.3s, then still:
 *   the score swells 0.92 → 1.04 and settles at 1;
 *   a gold rule draws out beneath it from the centre;
 *   a few small stars catch the light around it, once, and go;
 *   a faint warm light rises in the panel and fades.
 * Without motion the panel simply shows the score and its gold rule.
 */
export function animatePerfectScore({
  score,
  rule,
  stars,
  glow,
  delay = 0,
}: {
  score: Target;
  rule: Target;
  stars: Element[];
  glow: Target;
  delay?: number;
}): Motion {
  if (!live(score, rule, glow)) return null;
  const tl = gsap.timeline({ delay });
  tl.fromTo(score!, { scale: 0.92 }, { scale: 1.04, duration: 0.42, ease: "power2.out" }, 0)
    .to(score!, { scale: 1, duration: 0.38, ease: "power1.inOut", clearProps: "transform" }, 0.42)
    .fromTo(rule!, { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: "power2.inOut", clearProps: "transform" }, 0.18)
    .fromTo(glow!, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, 0.22)
    .to(glow!, { opacity: 0, duration: 0.55, ease: "power1.inOut" }, 0.75);
  if (stars.length > 0) {
    tl.fromTo(
      stars,
      { opacity: 0, scale: 0.4 },
      { opacity: 1, scale: 1, duration: 0.26, ease: "power2.out", stagger: 0.07 },
      0.38
    ).to(stars, { opacity: 0, scale: 0.75, duration: 0.32, ease: "power1.in", stagger: 0.05 }, 0.86);
  }
  return tl;
}
