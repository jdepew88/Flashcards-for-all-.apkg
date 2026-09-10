// Extracted from CCNA Practice Labs (ccna-10-week-dev) — src/lib/flashcards/anki-template.ts
// at commit 2a66e957007a9465e5e06042ad8e450b419dd42f.
//
// Renders Anki note templates ({{Field}}, {{#Cond}}...{{/Cond}}, {{cloze:Field}},
// {{FrontSide}}) to HTML, then sanitizes the result. Copied verbatim: the
// rendering behavior IS the file-format compatibility contract, so it must not
// drift from the CCNA Practice Labs implementation.

export interface AnkiTemplate {
  qfmt: string;
  afmt: string;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

function applyConditionals(template: string, fields: Record<string, string>): string {
  let out = template;
  out = out.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, rawName, inner) => {
    const value = fields[rawName.trim()] ?? "";
    return stripHtml(value).length > 0 ? inner : "";
  });
  out = out.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, rawName, inner) => {
    const value = fields[rawName.trim()] ?? "";
    return stripHtml(value).length === 0 ? inner : "";
  });
  return out;
}

function renderClozeField(rawValue: string, activeOrdinal: number, reveal: boolean): string {
  return rawValue.replace(
    /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g,
    (_match, numStr, content, hint) => {
      const num = Number(numStr);
      if (num !== activeOrdinal) return content;
      if (reveal) return `<span class="cloze-reveal">${content}</span>`;
      return `<span class="cloze-blank">[${hint && hint.length > 0 ? hint : "..."}]</span>`;
    }
  );
}

function substituteFields(
  template: string,
  fields: Record<string, string>,
  ctx: { activeOrdinal: number; reveal: boolean; frontHtml?: string }
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawName) => {
    const name = rawName.trim();
    if (name === "FrontSide") return ctx.frontHtml ?? "";
    if (name.toLowerCase().startsWith("cloze:")) {
      const fieldName = name.slice(name.indexOf(":") + 1).trim();
      const raw = fields[fieldName] ?? "";
      return renderClozeField(raw, ctx.activeOrdinal, ctx.reveal);
    }
    if (name.includes(":")) return "";
    return fields[name] ?? "";
  });
}

function finalizeStrayTags(html: string): string {
  return html.replace(/\{\{[^{}]*\}\}/g, "");
}

export function renderCard(
  template: AnkiTemplate,
  fields: Record<string, string>,
  cardOrdinal: number
): { front: string; back: string } {
  const activeOrdinal = cardOrdinal + 1;

  const qfmt = applyConditionals(template.qfmt, fields);
  const front = finalizeStrayTags(substituteFields(qfmt, fields, { activeOrdinal, reveal: false }));

  const afmt = applyConditionals(template.afmt, fields);
  const back = finalizeStrayTags(
    substituteFields(afmt, fields, { activeOrdinal, reveal: true, frontHtml: front })
  );

  return { front, back };
}

export function convertSoundTags(html: string): string {
  return html.replace(
    /\[sound:([^\]]+)\]/g,
    (_match, src) => `<audio controls class="anki-audio" src="${src}"></audio>`
  );
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

export function externalizeLinks(html: string): string {
  return html.replace(
    /<a\s+([^>]*?)href=(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi,
    (match, pre, quote, href, post) => {
      const attrs = `${pre}${post}`;
      if (/\btarget\s*=/.test(attrs)) return match;
      return `<a ${pre}href=${quote}${href}${quote}${post} target="_blank" rel="noopener noreferrer">`;
    }
  );
}

/** Finds bare (non-absolute) media filenames referenced by <img>/<audio> src attributes. */
export function collectMediaFilenames(html: string, out: Set<string>): void {
  const re = /<(?:img|audio)[^>]*\ssrc=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const src = match[1];
    if (!/^(https?:|data:|blob:|\/)/i.test(src)) out.add(src);
  }
}

/** Rewrites bare media filenames in <img>/<audio> src attributes using `resolve`. */
export function resolveCardMedia(html: string, resolve: (filename: string) => string | undefined): string {
  return html.replace(
    /(<(?:img|audio)[^>]*\ssrc=)(["'])([^"']+)\2/gi,
    (match, prefix, quote, src) => {
      if (/^(https?:|data:|blob:|\/)/i.test(src)) return match;
      const resolved = resolve(src);
      return resolved ? `${prefix}${quote}${resolved}${quote}` : match;
    }
  );
}
