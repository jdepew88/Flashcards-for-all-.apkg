// The room behind every screen: a night sky through the window, a desk lamp
// at the right, a stack of books and a few leaves at the left.
//
// It is drawn, not photographed. The sky, the lamp's light and the desk are CSS
// gradients (the --scene-* tokens in styles.css, so Light and Dark each have
// their own); the lamp, books, pencil cup and leaves are a few kilobytes of
// inline SVG. Nothing here is an image request, and nothing is interactive or
// announced. The furniture only appears where the viewport has room beside the
// content column — a phone gets the sky and a handful of stars, so the card
// keeps the screen.

import { Sparkle } from "@/components/ui/decor";
import { cn } from "@/lib/utils";

interface Star {
  /** Position, in percent of the viewport. */
  x: number;
  y: number;
  /** Size in px. */
  size: number;
  tone: "gold" | "mint";
  /** Twinkle delay in seconds; omitted for a still star. */
  twinkle?: number;
  /** Only where there is room for more than the essentials. */
  wide?: boolean;
}

const STARS: Star[] = [
  { x: 7, y: 9, size: 14, tone: "gold", twinkle: 0.4 },
  { x: 22, y: 6, size: 8, tone: "mint", wide: true },
  { x: 36, y: 13, size: 10, tone: "gold", wide: true },
  { x: 58, y: 7, size: 9, tone: "mint", twinkle: 2.1 },
  { x: 81, y: 19, size: 15, tone: "gold" },
  { x: 91, y: 6, size: 9, tone: "mint", wide: true },
  { x: 4, y: 34, size: 9, tone: "mint", wide: true },
  { x: 95, y: 30, size: 12, tone: "gold", twinkle: 1.3, wide: true },
  { x: 13, y: 52, size: 12, tone: "gold", wide: true },
  { x: 88, y: 58, size: 9, tone: "mint", twinkle: 3.2, wide: true },
  { x: 9, y: 76, size: 9, tone: "gold", twinkle: 2.6, wide: true },
  { x: 93, y: 82, size: 11, tone: "gold", wide: true },
  { x: 48, y: 3, size: 7, tone: "gold", wide: true },
  { x: 82, y: 22, size: 7, tone: "mint", wide: true },
];

/** Pin-prick stars: one tiled layer of tiny dots, far cheaper than elements. */
const STAR_DUST = [
  "radial-gradient(1px 1px at 12% 18%, rgb(255 255 255 / 70%), transparent)",
  "radial-gradient(1px 1px at 31% 44%, rgb(180 240 220 / 60%), transparent)",
  "radial-gradient(1.5px 1.5px at 52% 22%, rgb(255 255 255 / 55%), transparent)",
  "radial-gradient(1px 1px at 68% 61%, rgb(255 230 170 / 60%), transparent)",
  "radial-gradient(1px 1px at 84% 14%, rgb(255 255 255 / 65%), transparent)",
  "radial-gradient(1.5px 1.5px at 92% 47%, rgb(180 240 220 / 50%), transparent)",
  "radial-gradient(1px 1px at 6% 71%, rgb(255 255 255 / 45%), transparent)",
  "radial-gradient(1px 1px at 41% 83%, rgb(255 230 170 / 40%), transparent)",
].join(", ");

export function Scenery() {
  return (
    <div className="scene" aria-hidden="true" data-testid="scenery">
      <div
        className="sparkle absolute inset-0"
        style={{ backgroundImage: STAR_DUST, backgroundSize: "34rem 30rem" }}
      />

      {STARS.map((star) => (
        <Sparkle
          key={`${star.x}-${star.y}`}
          twinkle={star.twinkle}
          className={cn(
            "absolute",
            star.tone === "gold" ? "text-gold" : "text-accent",
            star.wide && "hidden md:block"
          )}
          style={{ left: `${star.x}%`, top: `${star.y}%`, width: star.size, height: star.size }}
        />
      ))}

      <div className="scene-desk" />

      {/* Lamp light pooling on the right: present at every size, as light only. */}
      <div
        className="scene-lamp-glow"
        style={{ right: "-14rem", top: "calc(34vh - 12rem)", width: "38rem", height: "30rem" }}
      />

      <Leaves className="scene-decor -left-10 -top-6 hidden w-64 blur-[1.5px] xl:block" />
      <Books className="scene-decor -left-6 bottom-0 hidden w-60 xl:block 2xl:w-72" />
      <Lamp className="scene-decor -right-4 top-[calc(34vh-11.5rem)] hidden w-64 xl:block 2xl:w-80" />
      <PencilCup className="scene-decor bottom-[5vh] right-6 hidden w-24 blur-[0.5px] xl:block 2xl:right-16" />
      <Leaves className="scene-decor -bottom-16 -left-16 hidden w-72 -scale-y-100 blur-[3px] 2xl:block" />

      <div className="scene-vignette" />
    </div>
  );
}

function Lamp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 420" className={className} focusable="false">
      <defs>
        <linearGradient id="lamp-shade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#24324a" />
          <stop offset="1" stopColor="#070c16" />
        </linearGradient>
        <radialGradient id="lamp-bulb" cx="0.5" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#fff3cf" />
          <stop offset="0.45" stopColor="#ffc56b" />
          <stop offset="1" stopColor="#f08a2e" />
        </radialGradient>
        <linearGradient id="lamp-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc56b" stopOpacity="0.34" />
          <stop offset="1" stopColor="#ffc56b" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Arm, reaching in from beyond the right edge. */}
      <path d="M330 18 222 128" stroke="#0a111e" strokeWidth="11" strokeLinecap="round" />
      <circle cx="222" cy="128" r="10" fill="#101a2b" />
      {/* The pool of light under the shade. */}
      <path d="M96 232 20 420h300l-36-188Z" fill="url(#lamp-cone)" />
      {/* Shade, seen slightly from below so its lit mouth shows. */}
      <path d="M84 226c8-64 58-112 128-108 52 4 84 44 90 108Z" fill="url(#lamp-shade)" />
      <ellipse cx="193" cy="228" rx="110" ry="24" fill="url(#lamp-bulb)" />
      <ellipse cx="193" cy="224" rx="110" ry="22" fill="none" stroke="#070c16" strokeWidth="5" />
      <path d="M118 150c22-18 48-26 78-24" stroke="#3b4d6d" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
    </svg>
  );
}

function Books({ className }: { className?: string }) {
  const books = [
    { y: 232, x: 8, w: 236, h: 54, cover: "#1b2c48", band: "#c9a86a" },
    { y: 180, x: 20, w: 214, h: 52, cover: "#3d2c22", band: "#d8b877" },
    { y: 134, x: 4, w: 226, h: 46, cover: "#213a55", band: "#8fd6bf" },
    { y: 92, x: 26, w: 190, h: 42, cover: "#4a3526", band: "#c9a86a" },
  ];
  return (
    <svg viewBox="0 0 260 290" className={className} focusable="false">
      {books.map((book) => (
        <g key={book.y}>
          <rect x={book.x} y={book.y} width={book.w} height={book.h} rx="5" fill={book.cover} />
          {/* The pages, showing at the fore-edge. */}
          <rect x={book.x + book.w - 16} y={book.y + 5} width="14" height={book.h - 10} rx="2" fill="#d9c8a0" opacity="0.85" />
          <rect x={book.x + 22} y={book.y} width="5" height={book.h} fill={book.band} opacity="0.75" />
          <rect x={book.x + 34} y={book.y} width="2" height={book.h} fill={book.band} opacity="0.5" />
          <rect x={book.x} y={book.y} width={book.w} height="3" rx="1.5" fill="#ffffff" opacity="0.08" />
        </g>
      ))}
      {/* A small plant pot resting on the stack. */}
      <path d="M70 92h64l-8-40H78Z" fill="#7a5a44" />
      <rect x="66" y="46" width="72" height="10" rx="3" fill="#8a6850" />
      <path d="M102 46c-4-22-20-34-40-36 6 16 18 30 40 36Zm0 0c2-26 14-40 36-44-2 20-14 36-36 44Zm0 0c-12-10-30-10-44-2 14 6 30 6 44 2Z" fill="#17574a" />
    </svg>
  );
}

function PencilCup({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 190" className={className} focusable="false">
      <path d="M30 86 22 14l6-10 6 10 6 72Z" fill="#d9a04e" />
      <path d="M48 86 52 22l7-11 5 12-4 63Z" fill="#c98a3c" />
      <path d="M62 86 78 30l8-8 2 11-14 53Z" fill="#b8793a" />
      <path d="M14 78h72l-5 104a6 6 0 0 1-6 6H25a6 6 0 0 1-6-6Z" fill="#c9b79a" />
      <path d="M14 78h72l-1.2 22H15.2Z" fill="#fff" opacity="0.18" />
    </svg>
  );
}

function Leaves({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 260" className={className} focusable="false">
      <g fill="#0f4a40">
        <path d="M10 10c70 6 120 40 140 104C86 104 34 70 10 10Z" />
        <path d="M0 96c52 0 96 26 116 74C64 166 22 140 0 96Z" opacity="0.85" />
        <path d="M96 0c56 14 92 46 104 96C150 84 112 52 96 0Z" opacity="0.7" />
        <path d="M0 176c36 4 64 24 78 58C42 228 14 208 0 176Z" opacity="0.6" />
      </g>
    </svg>
  );
}
