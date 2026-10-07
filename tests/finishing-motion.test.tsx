/**
 * The finishing touches (gsap-motion.ts): when each animation runs, that it
 * runs only on a real change of the state it follows, that reduced motion
 * leaves the resting state with no flourish, and that nothing is left running
 * or holding a transform once its element is gone.
 *
 * The timings themselves are not pinned here — they are reviewed by eye in
 * real browsers. What is pinned is the trigger, the cleanup and the result.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { gsap } from "gsap";

const spies = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("@/lib/gsap-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gsap-motion")>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of [
    "animateDeckComplete",
    "animateKnownMark",
    "animatePerfectScore",
    "animateProgressMilestone",
    "animateStudyDirectionChange",
    "animateHomepageEntrance",
    "animateDeckImport",
    "releaseDeck",
  ] as const) {
    spies[name] = vi.fn(actual[name] as (...args: unknown[]) => unknown);
    wrapped[name] = spies[name];
  }
  return wrapped;
});

// The parser is not what is under test here: an import returns this deck at once.
vi.mock("@/lib/flashcards/client-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flashcards/client-import")>();
  return {
    ...actual,
    parseApkgFile: async () => ({
      deck: { ...deckFixture(), slug: "upload-arrived", title: "Arrived Deck" },
      media: new Map(),
    }),
  };
});

function deckFixture(): FlashcardDeck {
  return {
    slug: "upload-fixture",
    title: "Fixture",
    cardCount: 1,
    chapters: [{ id: "Ch", name: "Ch", cardCount: 1 }],
    cards: [{ id: 1, chapter: "Ch", tags: [], front: "<p>F</p>", back: "<p>B</p>" }],
  };
}

import { FlashcardViewer } from "@/components/flashcard-viewer";
import { StudyDirectionControl } from "@/components/study-direction-control";
import { UploadScreen } from "@/components/upload-screen";
import {
  animateDeckComplete,
  animateDeckImport,
  animateHomepageEntrance,
  animateKnownMark,
  animatePerfectScore,
  animateProgressMilestone,
  animateStudyDirectionChange,
  finishMotion,
  resetHomepageEntrance,
} from "@/lib/gsap-motion";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { deleteAllUploadedDecks } from "@/lib/flashcards/uploaded-decks";
import { DEFAULT_FONT_SIZE, useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import { COMPACT_QUERY, REDUCED_MOTION_QUERY } from "@/lib/use-media-query";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const deck: FlashcardDeck = {
  slug: "upload-finish",
  title: "Finish Deck",
  cardCount: 4,
  chapters: [{ id: "Only", name: "Only", cardCount: 4 }],
  cards: [1, 2, 3, 4].map((n) => ({
    id: n,
    chapter: "Only",
    tags: [],
    front: `<p>Front ${n}</p>`,
    back: `<p>Back ${n}</p>`,
  })),
};

/** A run long enough for 25/50/75% to mean something. */
const longDeck: FlashcardDeck = {
  ...deck,
  slug: "upload-long",
  cardCount: 12,
  chapters: [{ id: "Only", name: "Only", cardCount: 12 }],
  cards: Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    chapter: "Only",
    tags: [],
    front: `<p>Front ${i + 1}</p>`,
    back: `<p>Back ${i + 1}</p>`,
  })),
};

const originalMatchMedia = window.matchMedia;

function setMedia({ compact = false, reduced = false } = {}) {
  window.matchMedia = ((query: string) => ({
    matches: (query === COMPACT_QUERY && compact) || (query === REDUCED_MOTION_QUERY && reduced),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const known = (...ids: number[]) =>
  useFlashcardsStore.setState({ knownByDeck: { [deck.slug]: ids } });

async function settle() {
  await waitFor(() => expect(screen.getAllByTestId("card-surface")).toHaveLength(1));
}

/** Steps to the last card, then on past it: the run is finished. */
async function finishRun(cards = 4) {
  for (let i = 1; i < cards; i++) {
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
  }
  fireEvent.keyDown(window, { key: "ArrowRight" });
  return screen.findByTestId("deck-complete");
}

beforeEach(() => {
  localStorage.clear();
  useFlashcardsStore.setState({ knownByDeck: {} });
  useFlashcardPrefsStore.setState({
    font: "serif",
    fontSize: DEFAULT_FONT_SIZE,
    controlMode: "gestures",
    gestureHintSeen: true,
    studyDirection: "front-first",
  });
  setMedia();
  for (const spy of Object.values(spies)) spy.mockClear();
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

describe("finishing a run", () => {
  it("shows the result in text, settles the deck and raises the panel — once", async () => {
    known(1, 3);
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const panel = await finishRun();

    expect(within(panel).getByRole("heading", { name: "Deck complete" })).toBeInTheDocument();
    expect(screen.getByTestId("completion-score")).toHaveTextContent("50%");
    expect(panel).toHaveTextContent("2 of 4 cards known");
    expect(screen.getByText("Deck complete. 2 of 4 cards known.")).toBeInTheDocument();
    expect(spies.animateDeckComplete).toHaveBeenCalledTimes(1);
    // The cards are out of reach under the panel.
    expect(screen.getByTestId("deck")).toHaveAttribute("inert");
  });

  it("plays the 100% flourish only when every card in the run is known", async () => {
    known(1, 2, 3);
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const panel = await finishRun();
    expect(screen.getByTestId("completion-score")).toHaveTextContent("75%");
    expect(panel).toHaveAttribute("data-perfect", "false");
    expect(screen.queryByTestId("completion-rule")).toBeNull();
    expect(screen.queryByTestId("completion-stars")).toBeNull();
    expect(spies.animatePerfectScore).not.toHaveBeenCalled();
    cleanup();

    known(1, 2, 3, 4);
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const perfect = await finishRun();
    expect(screen.getByTestId("completion-score")).toHaveTextContent("100%");
    expect(perfect).toHaveAttribute("data-perfect", "true");
    expect(perfect).toHaveTextContent("Every card known");
    expect(spies.animatePerfectScore).toHaveBeenCalledTimes(1);
    // A handful of stars, never more, and none of them in the accessibility tree.
    const stars = screen.getByTestId("completion-stars");
    expect(stars).toHaveAttribute("aria-hidden", "true");
    expect(stars.children.length).toBeGreaterThanOrEqual(3);
    expect(stars.children.length).toBeLessThanOrEqual(6);
  });

  it("never rounds a nearly-known run up to 100%", async () => {
    const big: FlashcardDeck = { ...longDeck, slug: deck.slug };
    useFlashcardsStore.setState({ knownByDeck: { [deck.slug]: big.cards.slice(1).map((c) => c.id) } });
    render(<FlashcardViewer deck={big} onExit={vi.fn()} />);
    await finishRun(12);
    expect(screen.getByTestId("completion-score")).toHaveTextContent("91%");
    expect(spies.animatePerfectScore).not.toHaveBeenCalled();
  });

  it("Back to cards (or Previous) puts the panel away and the deck comes back up; Restart starts over", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await finishRun();

    await user.click(screen.getByRole("button", { name: "Back to cards" }));
    expect(screen.queryByTestId("deck-complete")).toBeNull();
    expect(spies.releaseDeck).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("deck")).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: /finish/i })).toBeEnabled();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByTestId("deck-complete");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.queryByTestId("deck-complete")).toBeNull();
    expect(within(screen.getByTestId("card-position")).getByText(/^Card \d/)).toHaveTextContent("Card 4 of 4");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await user.click(await screen.findByRole("button", { name: "Restart" }));
    await settle();
    expect(screen.queryByTestId("deck-complete")).toBeNull();
    expect(within(screen.getByTestId("card-position")).getByText(/^Card \d/)).toHaveTextContent("Card 1 of 4");
  });

  it("does not flip or mark a card behind the panel", async () => {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await finishRun();
    fireEvent.keyDown(window, { key: "k" });
    expect(useFlashcardsStore.getState().knownByDeck[deck.slug] ?? []).toEqual([]);
    expect(screen.getByTestId("card-flipper")).toHaveAttribute("data-flipped", "false");
  });

  it("kills the flourish and lets the deck go when the study screen goes away mid-sequence", async () => {
    known(1, 2, 3, 4);
    const { unmount } = render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await finishRun();
    const flourish = spies.animatePerfectScore.mock.results[0].value as gsap.core.Timeline;
    const settleDeck = spies.animateDeckComplete.mock.results[0].value as gsap.core.Timeline;
    expect(flourish).not.toBeNull();
    const killFlourish = vi.spyOn(flourish, "kill");
    const killSettle = vi.spyOn(settleDeck, "kill");
    unmount();
    expect(killFlourish).toHaveBeenCalled();
    expect(killSettle).toHaveBeenCalled();
    expect(spies.releaseDeck).toHaveBeenCalledTimes(1);
  });

  it("with reduced motion: the same result and the static gold rule, no movement or flourish", async () => {
    setMedia({ reduced: true });
    known(1, 2, 3, 4);
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    await finishRun();

    expect(screen.getByTestId("completion-score")).toHaveTextContent("100%");
    expect(spies.animatePerfectScore.mock.results[0].value).toBeNull();
    expect(spies.animateDeckComplete.mock.results[0].value).toBeNull();
    // Resting state: the rule drawn, the stars and the glow unseen, nothing moved.
    expect(screen.getByTestId("completion-rule").style.transform).toBe("");
    for (const star of screen.getByTestId("completion-stars").children) {
      expect((star as HTMLElement).style.opacity).toBe("0");
    }
    expect(screen.getByTestId("completion-glow")).toHaveClass("opacity-0");
    expect(screen.getByTestId("deck").style.transform).toBe("");
  });
});

describe("marking a card known", () => {
  it("sets the check only when the mark changes, not when a known card arrives", async () => {
    known(2);
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    // Card 2 arrived already known: no mark set.
    expect(spies.animateKnownMark).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "k" });
    // Marking (or unmarking) leaves the reader on the same card.
    expect(within(screen.getByTestId("card-position")).getByText(/^Card \d/)).toHaveTextContent("Card 2 of 4");
    const calls = spies.animateKnownMark.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    // Each call is on the check of a Known toggle.
    for (const [el] of spies.animateKnownMark.mock.calls) {
      expect(el).toHaveAttribute("data-testid", "known-mark");
    }

    // A re-render that does not change the mark sets nothing.
    act(() => useFlashcardPrefsStore.setState({ fontSize: DEFAULT_FONT_SIZE + 1 }));
    expect(spies.animateKnownMark).toHaveBeenCalledTimes(calls);
  });
});

describe("progress milestones", () => {
  it("marks 25, 50 and 75% going forward, and nothing in between or going back", async () => {
    setMedia({ compact: true });
    useFlashcardsStore.setState({ knownByDeck: {} });
    render(<FlashcardViewer deck={longDeck} onExit={vi.fn()} />);
    const reachedAt: number[] = [];
    for (let card = 2; card <= 12; card++) {
      const before = spies.animateProgressMilestone.mock.calls.length;
      fireEvent.keyDown(window, { key: "ArrowRight" });
      await settle();
      if (spies.animateProgressMilestone.mock.calls.length > before) reachedAt.push(card);
    }
    // 12 cards: a quarter is card 3, a half card 6, three quarters card 9.
    expect(reachedAt).toEqual([3, 6, 9]);
    const [track] = spies.animateProgressMilestone.mock.calls[0];
    expect(track).toHaveAttribute("data-progress-track");

    const total = spies.animateProgressMilestone.mock.calls.length;
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await settle();
    expect(spies.animateProgressMilestone).toHaveBeenCalledTimes(total);
  });
});

describe("study direction", () => {
  it("moves the chosen option's arrow, and leaves the card as it is", async () => {
    const user = userEvent.setup();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    const flipper = screen.getByTestId("card-flipper");

    await user.click(screen.getByTestId("pin-direction"));
    expect(spies.animateKnownMark).toHaveBeenCalledTimes(1); // the pin, set
    expect(flipper).toHaveAttribute("data-flipped", "false");
    expect(screen.getByTestId("card-flipper")).toBe(flipper);
  });

  it("animates only on a change of direction", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StudyDirectionControl value="front-first" onChange={onChange} />);
    rerender(<StudyDirectionControl value="front-first" onChange={onChange} />);
    expect(spies.animateStudyDirectionChange).not.toHaveBeenCalled();

    rerender(<StudyDirectionControl value="back-first" onChange={onChange} />);
    expect(spies.animateStudyDirectionChange).toHaveBeenCalledTimes(1);
    expect(spies.animateStudyDirectionChange).toHaveBeenCalledWith(screen.getByTestId("direction-arrow-back-first"));
  });
});

describe("the home page entrance", () => {
  it("plays once per visit: not on re-renders, not when the page comes back", () => {
    resetHomepageEntrance();
    const { rerender, unmount } = render(<UploadScreen onStudy={vi.fn()} />);
    expect(spies.animateHomepageEntrance).toHaveBeenCalledTimes(1);
    const [elements] = spies.animateHomepageEntrance.mock.calls[0] as [Element[]];
    expect(elements.length).toBeGreaterThanOrEqual(4);
    expect(elements.length).toBeLessThanOrEqual(6);
    expect(spies.animateHomepageEntrance.mock.results[0].value).not.toBeNull();

    rerender(<UploadScreen onStudy={vi.fn()} />);
    expect(spies.animateHomepageEntrance).toHaveBeenCalledTimes(1);

    unmount();
    render(<UploadScreen onStudy={vi.fn()} />);
    expect(spies.animateHomepageEntrance.mock.results[1].value).toBeNull();
  });
});

describe("an imported deck", () => {
  it("settles into the library once, when the reader first comes back to it", async () => {
    await deleteAllUploadedDecks();
    const user = userEvent.setup();
    // As in the app: importing a deck opens it, replacing the home page.
    function App() {
      const [studying, setStudying] = useState<string | null>(null);
      return studying ? (
        <button type="button" onClick={() => setStudying(null)}>
          Back to your decks
        </button>
      ) : (
        <UploadScreen onStudy={setStudying} />
      );
    }
    render(<App />);
    await user.upload(
      document.querySelector<HTMLInputElement>("#apkg-upload")!,
      new File([new Uint8Array([1])], "arrived.apkg")
    );
    const back = await screen.findByRole("button", { name: "Back to your decks" });
    // It opened straight away: nothing has settled yet.
    expect(spies.animateDeckImport).not.toHaveBeenCalled();

    // Back to the library: the new deck arrives, once.
    await user.click(back);
    await screen.findByText("Arrived Deck");
    await waitFor(() => expect(spies.animateDeckImport).toHaveBeenCalledTimes(1));
    const [tile] = spies.animateDeckImport.mock.calls[0];
    expect(tile).toHaveAttribute("data-slug", "upload-arrived");

    // Opening it and coming back again does not replay it.
    await user.click(within(screen.getByRole("list", { name: "Saved decks" })).getByRole("button", { name: "Study" }));
    await user.click(await screen.findByRole("button", { name: "Back to your decks" }));
    await screen.findByText("Arrived Deck");
    expect(spies.animateDeckImport).toHaveBeenCalledTimes(1);
    await deleteAllUploadedDecks();
  });
});

describe("the motion module", () => {
  const el = () => document.body.appendChild(document.createElement("div"));
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does nothing under reduced motion", () => {
    setMedia({ reduced: true });
    resetHomepageEntrance();
    expect(animateKnownMark(el())).toBeNull();
    expect(animateProgressMilestone(el())).toBeNull();
    expect(animateStudyDirectionChange(el())).toBeNull();
    expect(animateDeckImport(el())).toBeNull();
    expect(animateHomepageEntrance([el(), el()])).toBeNull();
    expect(animateDeckComplete({ deck: el(), panel: el() })).toBeNull();
    expect(animatePerfectScore({ score: el(), rule: el(), stars: [el()], glow: el() })).toBeNull();
  });

  it("never loops, and leaves no transform behind once finished early", () => {
    const target = el();
    for (const motion of [
      animateKnownMark(target),
      animateProgressMilestone(target),
      animateStudyDirectionChange(target),
      animateDeckImport(target),
    ]) {
      expect(motion).not.toBeNull();
      expect(motion!.totalDuration()).toBeLessThan(0.5);
      finishMotion(motion);
      expect(target.style.transform).toBe("");
    }
    const flourish = animatePerfectScore({ score: el(), rule: el(), stars: [el(), el(), el()], glow: el() })!;
    expect(flourish.totalDuration()).toBeGreaterThanOrEqual(1);
    expect(flourish.totalDuration()).toBeLessThanOrEqual(1.5);
    flourish.kill();
    gsap.globalTimeline.clear();
  });
});
