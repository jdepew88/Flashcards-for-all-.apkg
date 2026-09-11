/**
 * What hyperlinks inside imported card content do.
 *
 * Anki decks often carry links — to a textbook, a bookshop, a reference page.
 * On a phone a link that fills most of a card face turns every tap into a trip
 * out of the study session, and every swipe that happens to start on it into
 * nothing at all. So card links are a study preference:
 *
 *   disabled (the default) — each link is rendered as plain text. It cannot
 *       navigate, is not a tab stop, is not announced as a link, and a tap or
 *       a swipe on it is just a tap or a swipe on the card.
 *   enabled — http(s) and mailto links stay links. Web links open in a new
 *       tab, detached from this one (target=_blank, rel=noopener noreferrer),
 *       so following one never replaces the study session.
 *
 * In both modes a link that could only point back into this page (`#…`, or an
 * href the sanitizer already neutralised to `#`) becomes plain text: this app
 * routes on the hash, so following one would drop the reader out of the deck.
 *
 * This runs at render time, on the output of sanitizeCardHtml. It only ever
 * removes or tightens — it never re-admits anything the sanitizer dropped —
 * and it never touches the stored deck or the original .apkg.
 */

import { normalizeUrl, sanitizeCardHtml } from "@/lib/flashcards/sanitize";

export type CardLinkMode = "disabled" | "enabled";

/** Class on the plain-text stand-in left where a card link was switched off. */
export const DISABLED_LINK_CLASS = "card-link-off";

/** Presentational attributes a stand-in keeps, so deck styling survives. */
const KEPT_ATTRIBUTES = ["class", "dir", "lang", "style"] as const;

function escapeText(html: string): string {
  return html.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

/** Applies `mode` to every <a> in already-sanitized card HTML. */
export function applyCardLinkPolicy(html: string, mode: CardLinkMode): string {
  if (!/<a[\s>]/i.test(html)) return html;
  // No DOM to parse with: there is no safe way to keep markup, so keep text.
  if (typeof DOMParser === "undefined") return escapeText(html);

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const anchor of [...doc.body.querySelectorAll("a")]) {
    const href = normalizeUrl(anchor.getAttribute("href") ?? "");
    const web = href.startsWith("https:") || href.startsWith("http:");

    if (mode === "enabled" && (web || href.startsWith("mailto:"))) {
      if (web) {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
      }
      continue;
    }

    const standIn = doc.createElement("span");
    for (const name of KEPT_ATTRIBUTES) {
      const value = anchor.getAttribute(name);
      if (value !== null) standIn.setAttribute(name, value);
    }
    standIn.classList.add(DISABLED_LINK_CLASS);
    standIn.append(...anchor.childNodes);
    anchor.replaceWith(standIn);
  }
  return doc.body.innerHTML;
}

// Rendered faces, most recently used last. Parsing a face is cheap but not
// free, and a card is rendered again every time the reader comes back to it;
// neighbours are rendered ahead of time (prewarmCardHtml) so moving to the
// next card never waits on a parse mid-animation.
const rendered = new Map<string, string>();
const RENDER_CACHE_LIMIT = 400;

/**
 * Card HTML exactly as it reaches the DOM: sanitized by today's rules (see
 * sanitize.ts for why this happens again at render), then the link policy.
 */
export function renderCardHtml(html: string, mode: CardLinkMode): string {
  const key = `${mode}:${html}`;
  const hit = rendered.get(key);
  if (hit !== undefined) {
    rendered.delete(key);
    rendered.set(key, hit);
    return hit;
  }
  // `allowBareMedia: false`: bundled media has already been resolved to blob:
  // URLs by now, so a plain src would be a network request the deck chose.
  const out = applyCardLinkPolicy(sanitizeCardHtml(html, { allowBareMedia: false }), mode);
  rendered.set(key, out);
  if (rendered.size > RENDER_CACHE_LIMIT) rendered.delete(rendered.keys().next().value!);
  return out;
}

/**
 * Renders a face ahead of time and starts decoding its images, so a card
 * slides in complete rather than painting its pictures a frame late. Images
 * here are only ever blob: or data: URLs — nothing touches the network.
 */
export function prewarmCardHtml(html: string, mode: CardLinkMode): void {
  const out = renderCardHtml(html, mode);
  if (typeof Image === "undefined") return;
  for (const [, src] of out.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)) {
    const image = new Image();
    image.src = src.replaceAll("&amp;", "&");
    image.decode?.().catch(() => {});
  }
}
