// Study options: every setting for a study session, in one place.
//
// Started as CCNA Practice Labs' flashcard-options-sheet.tsx (font, text size,
// exit). It now also holds what used to be a toolbar above the card — chapter
// filter, shuffle, hide-known, restart — plus how phone-sized screens are
// operated and the keyboard shortcuts. Moving them here is what lets the study
// screen give the card nearly all of its space.
//
// A bottom sheet on phone-sized screens (drag the handle down to dismiss), a
// side panel on larger ones. Modal either way: focus moves in, Tab stays in,
// Escape closes, focus returns to the button that opened it.

import { useEffect, useId, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import {
  ChevronDown,
  EyeOff,
  Hand,
  LogOut,
  Minus,
  MousePointerClick,
  Plus,
  RotateCcw,
  Shuffle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { trapFocus } from "@/lib/focus";
import { FLASHCARD_FONTS, type FlashcardFontId } from "@/lib/fonts";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, type ControlMode } from "@/lib/stores/prefs-store";
import type { FlashcardDeck } from "@/lib/flashcards/types";

const CONTROL_MODES: { value: ControlMode; label: string; Icon: typeof Hand }[] = [
  { value: "gestures", label: "Gestures", Icon: Hand },
  { value: "buttons", label: "Buttons", Icon: MousePointerClick },
];

export interface FlashcardOptionsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Phone-sized layout: bottom sheet instead of side panel. */
  compact: boolean;
  chapters: FlashcardDeck["chapters"];
  totalCards: number;
  chapter: string;
  onChapterChange: (chapter: string) => void;
  shuffle: boolean;
  onShuffleChange: (shuffle: boolean) => void;
  hideKnown: boolean;
  onHideKnownChange: (hide: boolean) => void;
  knownCount: number;
  onRestart: () => void;
  showControlMode: boolean;
  controlMode: ControlMode;
  onControlModeChange: (mode: ControlMode) => void;
  showShortcuts: boolean;
  font: FlashcardFontId;
  onFontChange: (font: FlashcardFontId) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  onResetProgress: () => void;
  onExit: () => void;
}

export function FlashcardOptionsSheet(props: FlashcardOptionsSheetProps) {
  const { open, onClose, compact } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const dragControls = useDragControls();
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        trapFocus(event, panelRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.y > 90 || info.velocity.y > 600) onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn(
              "fixed z-50 flex flex-col border-border bg-surface-elevated shadow-float",
              compact
                ? "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[1.75rem] border-t"
                : "bottom-4 right-4 top-4 w-[min(24rem,calc(100vw-2rem))] rounded-3xl border"
            )}
            initial={compact ? { y: "100%" } : { x: 32, opacity: 0 }}
            animate={compact ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={compact ? { y: "100%" } : { x: 32, opacity: 0 }}
            transition={{ type: "spring", damping: 34, stiffness: 360 }}
            drag={compact ? "y" : false}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
          >
            {compact && (
              <div
                aria-hidden
                onPointerDown={(event) => dragControls.start(event)}
                className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
              >
                <span className="h-1.5 w-11 rounded-full bg-border-strong" />
              </div>
            )}

            <div className={cn("flex shrink-0 items-center justify-between px-5 pb-1", !compact && "pt-4")}>
              <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                Study options
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close options"
                className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
              <OptionsBody {...props} />
            </div>

            <div
              className="grid shrink-0 grid-cols-2 gap-2 border-t border-border px-5 pt-3"
              style={{ paddingBottom: compact ? "max(1rem, env(safe-area-inset-bottom))" : "1rem" }}
            >
              <Button
                variant="secondary"
                className="px-3 text-[14px] text-danger"
                onClick={props.onResetProgress}
                disabled={props.knownCount === 0}
              >
                <RotateCcw className="h-4 w-4" />
                Reset progress
              </Button>
              <Button variant="secondary" className="px-3 text-[14px]" onClick={props.onExit}>
                <LogOut className="h-4 w-4" />
                Exit study session
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function OptionsBody({
  chapters,
  totalCards,
  chapter,
  onChapterChange,
  shuffle,
  onShuffleChange,
  hideKnown,
  onHideKnownChange,
  knownCount,
  onRestart,
  showControlMode,
  controlMode,
  onControlModeChange,
  showShortcuts,
  font,
  onFontChange,
  fontSize,
  onFontSizeChange,
}: FlashcardOptionsSheetProps) {
  return (
    <>
      <Section title="Cards">
        <div className="relative">
          <select
            value={chapter}
            onChange={(event) => onChapterChange(event.target.value)}
            aria-label="Filter by chapter"
            className="h-12 w-full min-w-0 appearance-none truncate rounded-2xl border border-border bg-surface pl-4 pr-10 text-[15px] font-medium text-foreground transition-colors hover:border-border-strong"
          >
            <option value="all">All chapters ({totalCards})</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.cardCount})
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          />
        </div>

        <div className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border">
          <SwitchRow
            icon={<Shuffle className="h-[18px] w-[18px]" />}
            label="Shuffle order"
            description="Study the cards in a random order."
            checked={shuffle}
            onChange={onShuffleChange}
          />
          <SwitchRow
            icon={<EyeOff className="h-[18px] w-[18px]" />}
            label="Hide known cards"
            description={`${knownCount} marked known in this deck.`}
            checked={hideKnown}
            onChange={onHideKnownChange}
          />
        </div>

        <Button variant="secondary" className="mt-2 w-full" onClick={onRestart}>
          <RotateCcw className="h-4 w-4" />
          Restart deck
        </Button>
      </Section>

      {showControlMode && (
        <Section title="Touch controls">
          <div
            role="group"
            aria-label="Touch controls"
            className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-muted p-1"
          >
            {CONTROL_MODES.map(({ value, label, Icon }) => {
              const pressed = controlMode === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onControlModeChange(value)}
                  className={cn(
                    "flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-[background-color,color,box-shadow] duration-150",
                    pressed
                      ? "bg-surface-elevated text-foreground shadow-soft"
                      : "text-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[13px] leading-relaxed text-muted">
            {controlMode === "gestures"
              ? "Swipe the card left or right to move, and tap it to flip."
              : "Previous, Flip and Next buttons along the bottom. Gestures still work too."}
          </p>
        </Section>
      )}

      <Section title="Reading">
        <div role="group" aria-label="Font" className="grid grid-cols-3 gap-1.5">
          {FLASHCARD_FONTS.map((f) => {
            const pressed = font === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => onFontChange(f.id)}
                style={{ fontFamily: f.variable }}
                className={cn(
                  "h-11 rounded-xl border px-2 text-sm transition-[background-color,border-color,color] duration-150",
                  pressed
                    ? "border-accent bg-accent-soft font-semibold text-accent"
                    : "border-border text-foreground hover:border-border-strong"
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border p-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onFontSizeChange(fontSize - 1)}
            disabled={fontSize <= MIN_FONT_SIZE}
            aria-label="Decrease text size"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <p className="flex-1 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
            {fontSize}px<span className="sr-only"> text size</span>
          </p>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onFontSizeChange(fontSize + 1)}
            disabled={fontSize >= MAX_FONT_SIZE}
            aria-label="Increase text size"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </Section>

      {showShortcuts && (
        <Section title="Keyboard">
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 rounded-2xl border border-border px-4 py-3 text-sm">
            <dt className="flex gap-1">
              <kbd className="kbd">←</kbd>
              <kbd className="kbd">→</kbd>
            </dt>
            <dd className="text-muted">Previous / next card</dd>
            <dt className="flex gap-1">
              <kbd className="kbd">Space</kbd>
            </dt>
            <dd className="text-muted">Flip the card (also ↑ ↓)</dd>
            <dt>
              <kbd className="kbd">K</kbd>
            </dt>
            <dd className="text-muted">Mark known</dd>
            <dt>
              <kbd className="kbd">Esc</kbd>
            </dt>
            <dd className="text-muted">Close this panel</dd>
          </dl>
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-2">
      <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SwitchRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface"
    >
      <span className={cn("shrink-0", checked ? "text-accent" : "text-muted")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block text-[15px] font-medium">
          {label}
        </span>
        <span id={descriptionId} className="block text-[13px] text-muted">
          {description}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150",
          checked ? "bg-accent" : "bg-border-strong"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-transform duration-200",
            checked && "translate-x-4"
          )}
        />
      </span>
    </button>
  );
}
