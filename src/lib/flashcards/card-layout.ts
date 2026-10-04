// How a card's HTML is laid out on the card. Presentation only: nothing here
// changes what a card says, what is stored, or what the sanitizer allows.

/** A face short enough to be set as display type: how long, and over how many lines. */
export interface DisplayFit {
  /** Characters the widest line is expected to hold. */
  chars: number;
  lines: number;
}

const DISPLAY_MAX_CHARS = 90;
const BRIEF_MAX_CHARS = 170;
/** Anything with structure of its own is laid out as a document instead. */
const STRUCTURED = /<(img|table|ul|ol|pre|audio|video|blockquote|h[1-6])\b/i;
const RULE = /<hr\b/i;

function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z#0-9]+;/gi, "x")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decides whether a face is a short term or question — plain text, no media —
 * and, if so, how much room its words need. The card turns that into a font
 * size that grows for a single word and eases down smoothly as text lengthens.
 */
export function displayFit(html: string): DisplayFit | null {
  if (STRUCTURED.test(html) || RULE.test(html)) return null;
  const text = plainText(html);
  if (text.length === 0 || text.length > DISPLAY_MAX_CHARS) return null;

  const longestWord = text.split(" ").reduce((longest, word) => Math.max(longest, word.length), 0);
  const lines = text.length <= 14 ? 1 : text.length <= 36 ? 2 : text.length <= 64 ? 3 : 4;
  const chars = Math.max(longestWord, Math.ceil(text.length / lines) + 2, 5);
  return { chars, lines };
}

/**
 * The CSS font-size for a display face: as wide as the card's width allows for
 * `chars` characters, as tall as its height allows for `lines` lines, never
 * smaller than the reader's chosen text size and never larger than `maxRem`.
 * `cqw` / `cqh` are measured against the card face (a size container).
 */
export function displayFontSize(fit: DisplayFit, basePx: number, maxRem = 6.5): string {
  const byWidth = (128 / fit.chars).toFixed(2);
  const byHeight = (44 / fit.lines).toFixed(2);
  return `clamp(${basePx}px, min(${byWidth}cqw, ${byHeight}cqh), ${maxRem}rem)`;
}

/**
 * The font-size for a face that is not display type. A brief one — a question
 * and its answer either side of a rule, a sentence or two — is set a little
 * larger on a roomy card; anything longer, or with media, a list or a table,
 * keeps exactly the reader's chosen text size.
 */
export function briefFontSize(html: string, basePx: number): string {
  if (STRUCTURED.test(html) || plainText(html).length > BRIEF_MAX_CHARS) return `${basePx}px`;
  return `clamp(${basePx}px, 3.5cqw, 1.45rem)`;
}

/**
 * Anki's default answer template repeats the question, then a rule, then the
 * answer: `{{FrontSide}}<hr id=answer>{{Back}}`. When a card's back has that
 * shape — a rule among its top-level nodes with content either side — the two
 * halves are wrapped so the stylesheet can set the question as the card's
 * title and the rest as the answer. Any other HTML is returned untouched.
 */
export function splitAnswer(html: string): string {
  if (!RULE.test(html) || typeof document === "undefined") return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  const nodes = [...template.content.childNodes];
  const ruleAt = nodes.findIndex((node) => node.nodeName === "HR");
  if (ruleAt < 0) return html;

  const hasContent = (list: ChildNode[]) =>
    list.some((node) => node.nodeType === Node.ELEMENT_NODE || (node.textContent ?? "").trim() !== "");
  const before = nodes.slice(0, ruleAt);
  const after = nodes.slice(ruleAt + 1);
  if (!hasContent(before) || !hasContent(after)) return html;

  const wrap = (className: string, list: ChildNode[]) => {
    const div = document.createElement("div");
    div.className = className;
    div.append(...list);
    return div;
  };
  template.content.replaceChildren(wrap("card-term", before), nodes[ruleAt], wrap("card-answer", after));
  return template.innerHTML;
}
