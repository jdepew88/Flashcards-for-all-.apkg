// Adapted from CCNA Practice Labs — src/lib/fonts.ts.
//
// The original loaded Merriweather / Quicksand / Atkinson Hyperlegible /
// Roboto Condensed through `next/font/google`. This build deliberately uses
// locally-resolvable stacks instead: the site makes a "nothing leaves your
// browser" promise, and a Google Fonts request would be a third-party call on
// every page load. The reading-options sheet and its persisted preference work
// exactly as before; only the typefaces differ.

export const FLASHCARD_FONTS = [
  {
    id: "sans",
    label: "Sans",
    variable: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: "serif",
    label: "Serif",
    variable: 'Georgia, "Iowan Old Style", "Times New Roman", Times, serif',
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
