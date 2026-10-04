// Adapted from CCNA Practice Labs — src/lib/fonts.ts.
//
// The original loaded Merriweather / Quicksand / Atkinson Hyperlegible /
// Roboto Condensed through `next/font/google`. This build deliberately uses
// locally-resolvable stacks instead: the site makes a "nothing leaves your
// browser" promise, and a Google Fonts request would be a third-party call on
// every page load. The reading-options sheet and its persisted preference work
// exactly as before; only the typefaces differ.

//
// The first entry is the default: the same display serif the wordmark and
// headings use (--font-display in styles.css), so a card's term and the site's
// name are visibly one family.

export const FLASHCARD_FONTS = [
  {
    id: "serif",
    label: "Serif",
    variable: '"Iowan Old Style", Charter, "Bitstream Charter", Georgia, "Times New Roman", serif',
  },
  {
    id: "sans",
    label: "Sans",
    variable: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: "mono",
    label: "Mono",
    variable: 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  {
    id: "rounded",
    label: "Rounded",
    variable: '"SF Pro Rounded", "Segoe UI Variable Display", ui-rounded, "Trebuchet MS", system-ui, sans-serif',
  },
  {
    id: "legible",
    label: "Accessible",
    variable: '"Atkinson Hyperlegible", "Verdana", "Tahoma", system-ui, sans-serif',
  },
  {
    id: "condensed",
    label: "Condensed",
    variable: '"Roboto Condensed", "Segoe UI Semibold", "Arial Narrow", system-ui, sans-serif',
  },
] as const;

export type FlashcardFontId = (typeof FLASHCARD_FONTS)[number]["id"];
