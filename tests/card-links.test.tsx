/**
 * Card links: what hyperlinks inside imported card content do.
 *
 * The real-world case this pins is a card whose front is mostly one long,
 * wrapping HTTPS link (a textbook, a bookshop page). With card links disabled
 * — the default — that text must behave exactly like the rest of the card: a
 * tap flips, a swipe navigates, nothing navigates away. With them enabled a
 * deliberate tap may follow the link, in a new tab detached from this one,
 * while a swipe that starts on it is still a swipe.
 *
 * The policy is applied at render time to sanitized HTML; the stored deck is
 * never changed, and nothing here loosens the sanitizer.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import {
  DISABLED_LINK_CLASS,
  applyCardLinkPolicy,
  renderCardHtml,
} from "@/lib/flashcards/card-links";
import { useFlashcardsStore } from "@/lib/stores/known-store";
import { DEFAULT_FONT_SIZE, useFlashcardPrefsStore } from "@/lib/stores/prefs-store";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const BOOK = "https://example.com/books/dual-energy-x-ray-absorptiometry-clinical-guide";

const deck: FlashcardDeck = {
  slug: "upload-links",
  title: "Link Deck",
  cardCount: 3,
  chapters: [{ id: "Only", name: "Only", cardCount: 3 }],
  cards: [
    { id: 1, chapter: "Only", tags: [], front: "<p>Plain one</p>", back: "<p>Back one</p>" },
    {
      id: 2,
      chapter: "Only",
      tags: [],
      front: `<p><a href="${BOOK}" class="book" style="color: rgb(200, 0, 0)" title="Buy">Dual-Energy X-Ray Absorptiometry: A Clinical Guide to DEXA Scanning — Fourth Edition, Chapter 12</a></p>`,
      back: `<p>See <a href="https://example.com/ref">the reference page</a>.</p>`,
    },
    { id: 3, chapter: "Only", tags: [], front: "<p>Plain three</p>", back: "<p>Back three</p>" },
  ],
};

/** "2 / 3" — the in-card position. */
function counter() {
  const position = screen.getByTestId("card-position");
  return `${within(position).getByTestId("card-position-current").textContent} / ${within(position).getByTestId("card-position-total").textContent}`;
}

const card = () => screen.getAllByTestId("card-surface").at(-1)!;
const isFlipped = () =>
  screen.getAllByTestId("card-flipper").at(-1)!.getAttribute("data-flipped") === "true";

async function settle() {
  await waitFor(() => expect(screen.getAllByTestId("card-surface")).toHaveLength(1));
}

/** The front face of the card on top. */
const front = () => card().querySelector<HTMLElement>('[data-face="front"]')!;

function drag(target: Element, dx: number) {
  const pointer = { pointerId: 3, pointerType: "touch", isPrimary: true, button: 0 };
  fireEvent.pointerDown(target, { ...pointer, clientX: 200, clientY: 300 });
  for (let i = 1; i <= 5; i++) {
    fireEvent.pointerMove(target, { ...pointer, clientX: 200 + (dx * i) / 5, clientY: 300 });
  }
  fireEvent.pointerUp(target, { ...pointer, clientX: 200 + dx, clientY: 300 });
  // A pointer's click after release; must never act after a swipe.
  return fireEvent.click(target, { clientX: 200 + dx, clientY: 300, detail: 1 });
}

// jsdom cannot open tabs; stop any link it is asked to follow, but only after
// every handler in the app has had its say (so defaultPrevented is theirs).
let clicks: { target: EventTarget | null; cancelledByApp: boolean }[] = [];
function recordClicks(event: MouseEvent) {
  clicks.push({ target: event.target, cancelledByApp: event.defaultPrevented });
  event.preventDefault();
}

beforeEach(() => {
  localStorage.clear();
  useFlashcardsStore.setState({ knownByDeck: {} });
  useFlashcardPrefsStore.setState({
    font: "sans",
    fontSize: DEFAULT_FONT_SIZE,
    controlMode: "gestures",
    gestureHintSeen: true,
    cardLinks: "disabled",
    homeScreenTipSeen: false,
  });
  clicks = [];
  window.addEventListener("click", recordClicks);
});

afterEach(() => {
  window.removeEventListener("click", recordClicks);
  cleanup();
});

describe("the link policy", () => {
  it("disabled: turns every link into plain text, keeping only its look", () => {
    const html = applyCardLinkPolicy(deck.cards[1].front, "disabled");
    const doc = new DOMParser().parseFromString(html, "text/html");

    expect(doc.querySelector("a")).toBeNull();
    // (Elements of a parsed document, so plain properties rather than jest-dom.)
    const standIn = doc.querySelector(`.${DISABLED_LINK_CLASS}`)!;
    expect(standIn.tagName).toBe("SPAN");
    expect(standIn.textContent).toMatch(/Dual-Energy X-Ray Absorptiometry/);
    expect(standIn.classList.contains("book")).toBe(true);
    expect(standIn.getAttribute("style")).toContain("color");
    for (const attr of ["href", "target", "rel", "title"]) expect(standIn.hasAttribute(attr)).toBe(false);
  });

  it("enabled: keeps web links, opening detached in a new tab", () => {
    const html = applyCardLinkPolicy(`<a href="${BOOK}">book</a>`, "enabled");
    const link = new DOMParser().parseFromString(html, "text/html").querySelector("a")!;

    expect(link.getAttribute("href")).toBe(BOOK);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("enabled: keeps mailto links as they are", () => {
    const html = applyCardLinkPolicy('<a href="mailto:tutor@example.com">email</a>', "enabled");
    const link = new DOMParser().parseFromString(html, "text/html").querySelector("a")!;

    expect(link.getAttribute("href")).toBe("mailto:tutor@example.com");
    expect(link.hasAttribute("target")).toBe(false);
  });

  it("never keeps a link back into this page — the app routes on the hash", () => {
    for (const mode of ["disabled", "enabled"] as const) {
      for (const href of ["#", "#section-2", ""]) {
        const html = applyCardLinkPolicy(`<a href="${href}">jump</a>`, mode);
        expect(html, `${mode} ${href}`).not.toContain("<a");
        expect(html).toContain("jump");
      }
    }
  });

  it("does not re-admit anything the sanitizer blocks, even when enabled", () => {
    for (const href of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      const html = renderCardHtml(`<a href="${href}">x</a>`, "enabled");
      expect(html, href).not.toMatch(/javascript|vbscript|data:/i);
      expect(html, href).not.toContain("<a");
    }
    expect(renderCardHtml('<a href="https://ok.example" onclick="steal()">x</a>', "enabled")).not.toContain("onclick");
  });

  it("works on a copy: the stored card is never changed", () => {
    const stored = structuredClone(deck.cards[1]);
    renderCardHtml(deck.cards[1].front, "disabled");
    renderCardHtml(deck.cards[1].front, "enabled");

    expect(deck.cards[1]).toEqual(stored);
    expect(deck.cards[1].front).toContain(`href="${BOOK}"`);
  });
});

describe("card links disabled (the default)", () => {
  async function onLinkCard() {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    expect(counter()).toBe("2 / 3");
    return front().querySelector<HTMLElement>(`.${DISABLED_LINK_CLASS}`)!;
  }

  it("shows the link as text: no link role, no tab stop", async () => {
    const text = await onLinkCard();

    expect(text).toHaveTextContent(/Clinical Guide to DEXA/);
    expect(within(front()).queryAllByRole("link")).toHaveLength(0);
    expect(card().querySelectorAll("a[href]")).toHaveLength(0);
  });

  it("a tap on the linked text flips the card and goes nowhere", async () => {
    const user = userEvent.setup();
    const text = await onLinkCard();

    await user.click(text);

    expect(isFlipped()).toBe(true);
    expect(counter()).toBe("2 / 3");
    expect(window.location.hash).not.toContain("example.com");
  });

  it("a swipe that starts on the linked text navigates, both ways", async () => {
    const text = await onLinkCard();

    drag(text, -150);
    await settle();
    expect(counter()).toBe("3 / 3");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await settle();
    drag(front().querySelector(`.${DISABLED_LINK_CLASS}`)!, 150);
    await settle();
    expect(counter()).toBe("1 / 3");
    expect(isFlipped()).toBe(false);
  });

  it("Previous and Next beside a link card do their job and nothing else", async () => {
    const user = userEvent.setup();
    await onLinkCard();
    const bar = within(screen.getByTestId("control-bar"));

    await user.click(bar.getByRole("button", { name: /next/i }));
    expect(counter()).toBe("3 / 3");
    await user.click(bar.getByRole("button", { name: /previous/i }));
    await settle();
    expect(counter()).toBe("2 / 3");
    expect(isFlipped()).toBe(false);
  });
});

describe("card links enabled", () => {
  beforeEach(() => useFlashcardPrefsStore.setState({ cardLinks: "enabled" }));

  async function onLinkCard() {
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    return within(front()).getByRole("link", { name: /Clinical Guide to DEXA/ });
  }

  it("renders a real link that opens detached from the study tab", async () => {
    const link = await onLinkCard();

    expect(link).toHaveAttribute("href", BOOK);
    expect(link).toHaveAttribute("target", "_blank");
    // noopener: the opened page gets no window.opener, so it cannot navigate
    // or script this tab. noreferrer: it is not told where the reader came from.
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("a deliberate tap is the link's: it is not cancelled and does not flip", async () => {
    const user = userEvent.setup();
    const link = await onLinkCard();

    await user.click(link);

    const onLink = clicks.filter((c) => c.target === link || link.contains(c.target as Node));
    expect(onLink).toHaveLength(1);
    expect(onLink[0].cancelledByApp).toBe(false);
    expect(isFlipped()).toBe(false);
    expect(counter()).toBe("2 / 3");
  });

  it("a swipe that starts on the link navigates, and the click after it is cancelled", async () => {
    const link = await onLinkCard();
    const onLinkClick = vi.fn();
    link.addEventListener("click", onLinkClick);

    // fireEvent returns false when the click's default action was prevented:
    // the link is not followed. It is also stopped before reaching the link.
    const followed = drag(link, -150);
    await settle();

    expect(counter()).toBe("3 / 3");
    expect(followed).toBe(false);
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it("a small wobble that is not a tap does not follow the link either", async () => {
    const link = await onLinkCard();

    const followed = drag(link, -20); // past tap slop, short of a swipe

    expect(counter()).toBe("2 / 3");
    expect(followed).toBe(false);
    expect(isFlipped()).toBe(false);
  });

  it("app controls never activate a card link", async () => {
    const user = userEvent.setup();
    const link = await onLinkCard();
    const onLinkClick = vi.fn();
    link.addEventListener("click", onLinkClick);

    const bar = within(screen.getByTestId("control-bar"));
    await user.click(bar.getByRole("button", { name: "Flip" }));
    await user.click(bar.getByRole("button", { name: "Flip" }));
    await user.click(screen.getByRole("button", { name: "Mark known" }));
    await user.click(screen.getByRole("button", { name: "Study options" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it("links on the hidden face are out of reach until it shows", async () => {
    await onLinkCard();
    const back = card().querySelector<HTMLElement>('[data-face="back"]')!;

    expect(back).toHaveAttribute("aria-hidden", "true");
    expect(back).toHaveAttribute("inert");
  });
});

describe("the card-links preference", () => {
  it("is set from Study options and remembered in this browser", async () => {
    const user = userEvent.setup();
    const view = render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Study options" }));
    const group = within(await screen.findByRole("group", { name: "Card links" }));
    expect(group.getByRole("button", { name: "Disabled" })).toHaveAttribute("aria-pressed", "true");

    await user.click(group.getByRole("button", { name: "Enabled" }));
    expect(group.getByRole("button", { name: "Enabled" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("flashcard-prefs-v1")).toContain('"cardLinks":"enabled"');

    view.unmount();
    render(<FlashcardViewer deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    expect(within(front()).getByRole("link", { name: /Clinical Guide/ })).toBeInTheDocument();
  });

  it("defaults to disabled for someone whose stored preferences predate it", async () => {
    localStorage.setItem(
      "flashcard-prefs-v1",
      JSON.stringify({ state: { font: "serif", fontSize: 20, controlMode: "buttons" }, version: 0 })
    );
    await useFlashcardPrefsStore.persist.rehydrate();

    expect(useFlashcardPrefsStore.getState().cardLinks).toBe("disabled");
    expect(useFlashcardPrefsStore.getState().controlMode).toBe("buttons");
  });
});
