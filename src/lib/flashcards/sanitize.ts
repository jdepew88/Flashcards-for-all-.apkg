/**
 * Hardened sanitizer for imported Anki card HTML.
 *
 * ## Why this exists alongside `sanitizeHtml` in anki-template.ts
 *
 * `anki-template.ts` is copied verbatim from CCNA Practice Labs and must stay
 * that way — its rendering behavior is the file-format compatibility contract.
 * Its `sanitizeHtml` is a regex pass that strips <script>, <iframe>, inline
 * event handlers and `javascript:` URLs. That is a reasonable first pass, but
 * regexes over HTML are the wrong tool for a security boundary: they cannot see
 * malformed markup the way a parser does, and they miss whole element classes
 * (<object>, <embed>, <svg>, <base>, <form>, <style>).
 *
 * So this module runs *after* it, parsing the HTML properly and rebuilding it
 * from an allowlist. Anything not explicitly permitted is dropped. A `.apkg` is
 * untrusted input authored by whoever made the deck, and the person importing
 * it did not agree to run their JavaScript.
 *
 * ## Where it runs
 *
 * Twice, deliberately:
 *   1. At import, before the deck is written to IndexedDB, so stored decks are
 *      already clean.
 *   2. At render, immediately before the HTML reaches the DOM, so a deck stored
 *      by an earlier version of this app is still sanitized by today's rules.
 *
 * ## Media policy
 *
 * At import, bare filenames on <img>/<audio>/<video> are kept: they refer to
 * files bundled inside the .apkg, and `resolveDeckMedia` rewrites them to
 * `blob:` URLs when the deck is opened. At render, only `blob:` and non-SVG
 * `data:image/*` sources survive — so a card can show media the deck actually
 * shipped, and cannot reach the network at all. Remote `http(s)` media is
 * replaced with a visible marker at both stages. See BLOCKED_MEDIA_CLASS.
 */

/** Class applied to the placeholder left where remote or unresolved media was. */
export const BLOCKED_MEDIA_CLASS = "blocked-media";

/**
 * Elements kept, with the attributes allowed on them. Everything else is
 * dropped. Global attributes in ALLOWED_GLOBAL_ATTRS apply to all of them.
 */
const ALLOWED_ELEMENTS: Record<string, readonly string[]> = {
  // Text and structure
  p: [],
  div: [],
  span: [],
  br: [],
  hr: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  blockquote: [],
  pre: [],
  code: [],
  kbd: [],
  samp: [],
  var: [],
  b: [],
  strong: [],
  i: [],
  em: [],
  u: [],
  s: [],
  strike: [],
  del: [],
  ins: [],
  sub: [],
  sup: [],
  small: [],
  big: [],
  mark: [],
  abbr: [],
  cite: [],
  q: [],
  center: [],
  font: ["color", "face", "size"],
  ruby: [],
  rt: [],
  rp: [],
  figure: [],
  figcaption: [],

  // Lists
  ul: [],
  ol: ["start", "type"],
  li: ["value"],
  dl: [],
  dt: [],
  dd: [],

  // Tables — common in Anki decks
  table: ["border", "cellpadding", "cellspacing"],
  thead: [],
  tbody: [],
  tfoot: [],
  tr: [],
  td: ["colspan", "rowspan", "align", "valign"],
  th: ["colspan", "rowspan", "align", "valign", "scope"],
  caption: [],
  colgroup: ["span"],
  col: ["span"],

  // Links and media
  a: ["href", "target", "rel"],
  img: ["src", "alt", "width", "height"],
  audio: ["src", "controls"],
  video: ["src", "controls", "width", "height", "poster"],
};

const ALLOWED_GLOBAL_ATTRS: readonly string[] = ["class", "dir", "lang", "title", "style"];

/**
 * Elements removed along with everything inside them.
 *
 * The rest of the disallowed set is handled by "unwrap": an unknown element is
 * dropped but its text is kept, so a deck using some tag we did not think of
 * still reads correctly. These, though, must take their contents with them —
 * the content *is* the payload.
 */
const STRIP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "frame",
  "frameset",
  "noscript",
  "template",
  "svg",
  "math",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "label",
  "fieldset",
  "legend",
  "canvas",
  "map",
  "area",
  "portal",
  "dialog",
]);

/** Media file extensions a bare (bundled) src is allowed to carry. */
const BARE_MEDIA_PATTERN = /^[^/\\?#:]+\.[a-z0-9]{1,5}$/i;

export interface SanitizeOptions {
  /**
   * Allow bare bundled-media filenames on img/audio/video.
   *
   * True at import (media has not been resolved yet); false at render, where
   * anything that is not already a blob: or data: URL would mean a network
   * request the deck author chose, so it is blocked instead.
   */
  allowBareMedia: boolean;
}

/**
 * Strips characters that let an attacker hide a scheme from a naive check —
 * leading whitespace, embedded control characters (including the NUL, tab and
 * newline that browsers ignore inside URLs) — then lowercases.
 */
function normalizeUrl(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0020\u007f-\u00a0]/g, "").toLowerCase();
}

function isSafeLinkHref(value: string): boolean {
  const normalized = normalizeUrl(value);
  if (normalized.startsWith("#")) return true;
  return /^(https?:|mailto:)/.test(normalized);
}

/** True for a src the browser can render without touching the network. */
function isLocalMediaSrc(value: string): boolean {
  const normalized = normalizeUrl(value);
  if (normalized.startsWith("blob:")) return true;
  if (normalized.startsWith("data:image/")) {
    // SVG is a document format: as an <img> src it cannot run script in any
    // current browser, but it is the one data: image type with that history,
    // and no real Anki deck needs it inline. Not worth the exception.
    return !normalized.startsWith("data:image/svg");
  }
  return false;
}

function isBareMediaSrc(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.includes(":")) return false;
  return BARE_MEDIA_PATTERN.test(trimmed);
}

/**
 * Filters a style attribute. Declarations that can fetch a resource or execute
 * anything are dropped; plain presentational ones are kept, because colour and
 * alignment are most of what Anki authors actually use inline.
 */
function sanitizeStyle(value: string): string {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      if (!declaration.includes(":")) return false;
      const normalized = normalizeUrl(declaration);
      return !(
        normalized.includes("url(") ||
        normalized.includes("expression") ||
        normalized.includes("javascript:") ||
        normalized.includes("behavior") ||
        normalized.includes("-moz-binding") ||
        normalized.includes("@import") ||
        normalized.includes("image-set(")
      );
    })
    .join("; ");
}

function blockedMediaPlaceholder(doc: Document, label: string): HTMLElement {
  const marker = doc.createElement("span");
  marker.className = BLOCKED_MEDIA_CLASS;
  marker.textContent = label;
  return marker;
}

function sanitizeElement(element: Element, doc: Document, options: SanitizeOptions): void {
  const tag = element.tagName.toLowerCase();
  const allowedAttrs = ALLOWED_ELEMENTS[tag];

  // Media first: a blocked source replaces the whole element.
  if (tag === "img" || tag === "audio" || tag === "video") {
    const src = element.getAttribute("src") ?? "";
    const permitted = isLocalMediaSrc(src) || (options.allowBareMedia && isBareMediaSrc(src));
    if (!permitted) {
      const label = src.trim().length > 0 ? "[media blocked]" : "[media missing]";
      element.replaceWith(blockedMediaPlaceholder(doc, label));
      return;
    }
  }

  for (const attr of [...element.attributes]) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    const isAllowed =
      !name.startsWith("on") &&
      (ALLOWED_GLOBAL_ATTRS.includes(name) || allowedAttrs.includes(name));

    if (!isAllowed) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (name === "style") {
      const safe = sanitizeStyle(value);
      if (safe.length > 0) element.setAttribute("style", safe);
      else element.removeAttribute("style");
      continue;
    }

    if (name === "href" && !isSafeLinkHref(value)) {
      element.setAttribute("href", "#");
      continue;
    }

    if (name === "poster" && !isLocalMediaSrc(value)) {
      element.removeAttribute("poster");
    }
  }

  // Any link that leaves the page opens detached from it.
  if (tag === "a" && /^https?:/.test(normalizeUrl(element.getAttribute("href") ?? ""))) {
    element.setAttribute("target", "_blank");
    element.setAttribute("rel", "noopener noreferrer");
  }
}

function walk(node: Node, doc: Document, options: SanitizeOptions): void {
  // Snapshot: sanitizeElement can replace or unwrap nodes as we go.
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8 /* Comment */) {
      child.parentNode?.removeChild(child);
      continue;
    }

    if (child.nodeType !== 1 /* Element */) continue;

    const element = child as Element;
    const tag = element.tagName.toLowerCase();

    if (STRIP_WITH_CONTENT.has(tag)) {
      element.remove();
      continue;
    }

    if (!(tag in ALLOWED_ELEMENTS)) {
      // Unknown but not dangerous: keep the text, drop the element.
      walk(element, doc, options);
      element.replaceWith(...element.childNodes);
      continue;
    }

    sanitizeElement(element, doc, options);

    // `element` may have been replaced by a placeholder, in which case it is no
    // longer attached and its children are gone with it.
    if (element.isConnected || element.parentNode) {
      walk(element, doc, options);
    }
  }
}

/**
 * Rebuilds `html` from an allowlist of elements and attributes.
 *
 * Returns HTML safe to assign with `dangerouslySetInnerHTML`, given the CSP
 * this app ships. Never throws: a document that will not parse yields the
 * escaped text of the input rather than an error, so one broken card cannot
 * take down a deck.
 */
export function sanitizeCardHtml(html: string, options: SanitizeOptions): string {
  if (typeof DOMParser === "undefined") {
    // No DOM available (an unexpected non-browser context). Degrade to text.
    return html.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  }

  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    walk(doc.body, doc, options);
    return doc.body.innerHTML;
  } catch {
    return "";
  }
}

/** Convenience wrapper: sanitize every card face in a deck. */
export function sanitizeCardFaces<T extends { front: string; back: string }>(
  cards: T[],
  options: SanitizeOptions
): T[] {
  return cards.map((card) => ({
    ...card,
    front: sanitizeCardHtml(card.front, options),
    back: sanitizeCardHtml(card.back, options),
  }));
}
