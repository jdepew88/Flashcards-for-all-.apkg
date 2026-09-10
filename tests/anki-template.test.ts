/**
 * The Anki template renderer, copied verbatim from CCNA Practice Labs.
 *
 * These are characterisation tests: they pin the behavior the CCNA build has,
 * so a future edit here that changes how a deck renders fails loudly instead of
 * quietly making this app incompatible with the one it was extracted from.
 */

import { describe, expect, it } from "vitest";
import {
  collectMediaFilenames,
  convertSoundTags,
  externalizeLinks,
  renderCard,
  resolveCardMedia,
  sanitizeHtml,
} from "@/lib/flashcards/anki-template";

const basic = { qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}" };

describe("renderCard", () => {
  it("substitutes fields on the front and pulls the front into the back", () => {
    const { front, back } = renderCard(basic, { Front: "Q?", Back: "A." }, 0);

    expect(front).toBe("Q?");
    expect(back).toBe("Q?<hr>A.");
  });

  it("leaves unknown fields empty rather than printing the tag", () => {
    const { front } = renderCard({ qfmt: "{{Front}} {{Nope}}", afmt: "" }, { Front: "Q" }, 0);

    expect(front).toBe("Q ");
  });

  it("honours {{#Field}} and {{^Field}} conditionals", () => {
    const tmpl = {
      qfmt: "{{#Hint}}hint: {{Hint}}{{/Hint}}{{^Hint}}no hint{{/Hint}}",
      afmt: "",
    };

    expect(renderCard(tmpl, { Hint: "look up" }, 0).front).toBe("hint: look up");
    expect(renderCard(tmpl, { Hint: "" }, 0).front).toBe("no hint");
    // A field holding only markup counts as empty — the conditional strips tags first.
    expect(renderCard(tmpl, { Hint: "<br>" }, 0).front).toBe("no hint");
  });

  it("blanks the active cloze on the front and reveals it on the back", () => {
    const tmpl = { qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}" };
    const fields = { Text: "The {{c1::first}} and the {{c2::second}}." };

    const ord0 = renderCard(tmpl, fields, 0);
    expect(ord0.front).toBe('The <span class="cloze-blank">[...]</span> and the second.');
    expect(ord0.back).toBe('The <span class="cloze-reveal">first</span> and the second.');

    const ord1 = renderCard(tmpl, fields, 1);
    expect(ord1.front).toBe('The first and the <span class="cloze-blank">[...]</span>.');
    expect(ord1.back).toBe('The first and the <span class="cloze-reveal">second</span>.');
  });

  it("uses a cloze hint when the note supplies one", () => {
    const { front } = renderCard(
      { qfmt: "{{cloze:Text}}", afmt: "" },
      { Text: "Port {{c1::443::the number}} is HTTPS." },
      0
    );

    expect(front).toBe('Port <span class="cloze-blank">[the number]</span> is HTTPS.');
  });

  it("drops filtered tags it does not implement and any stray braces", () => {
    const { front } = renderCard(
      { qfmt: "{{type:Back}}{{Front}}{{Unclosed", afmt: "" },
      { Front: "Q", Back: "A" },
      0
    );

    expect(front).toBe("Q{{Unclosed");
    expect(front).not.toContain("{{type:");
  });
});

describe("sanitizeHtml", () => {
  it("strips script and iframe elements", () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).toBe("<p>ok</p>");
    expect(sanitizeHtml('<iframe src="x"></iframe>hi')).toBe("hi");
  });

  it("strips inline event handlers", () => {
    expect(sanitizeHtml('<img src="a.png" onerror="steal()">')).toBe('<img src="a.png">');
    expect(sanitizeHtml("<div onclick=go()>x</div>")).toBe("<div>x</div>");
  });

  it("neutralises javascript: URLs", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>');
  });
});

describe("externalizeLinks", () => {
  it("opens absolute links in a new tab with noopener", () => {
    const out = externalizeLinks('<a href="https://example.com">docs</a>');

    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("leaves a link that already declares a target alone", () => {
    const input = '<a href="https://example.com" target="_self">docs</a>';

    expect(externalizeLinks(input)).toBe(input);
  });
});

describe("media handling", () => {
  it("converts Anki [sound:] tags into audio elements", () => {
    expect(convertSoundTags("Listen [sound:clip.mp3]")).toBe(
      'Listen <audio controls class="anki-audio" src="clip.mp3"></audio>'
    );
  });

  it("collects only bare (bundled) media filenames", () => {
    const found = new Set<string>();
    collectMediaFilenames(
      '<img src="a.png"><img src="https://cdn.example/b.png"><img src="/c.png">' +
        '<audio src="d.mp3"></audio><img src="data:image/png;base64,zz">',
      found
    );

    expect([...found].sort()).toEqual(["a.png", "d.mp3"]);
  });

  it("rewrites bare filenames through the resolver and leaves absolute URLs alone", () => {
    const html = '<img src="a.png"><img src="https://cdn.example/b.png"><img src="missing.png">';
    const out = resolveCardMedia(html, (name) => (name === "a.png" ? "blob:local-a" : undefined));

    expect(out).toContain('src="blob:local-a"');
    expect(out).toContain('src="https://cdn.example/b.png"');
    // An unresolvable filename is left as-is rather than blanked.
    expect(out).toContain('src="missing.png"');
  });
});
