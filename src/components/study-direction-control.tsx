// Study direction: which side a card opens on — the word, or the definition.
//
// One choice, kept in the reading preferences (prefs-store.ts), offered in two
// places: beside the deck list before a deck is opened, and in Study options
// during a session. Styled as the options sheet's two-way switches. Each
// option is a toggle button that says whether it is the one in use. When the
// choice changes, the arrow of the option now in use slides into place.

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { animateStudyDirectionChange, finishMotion } from "@/lib/gsap-motion";
import type { StudyDirection } from "@/lib/stores/prefs-store";

const DIRECTIONS: { value: StudyDirection; from: string; to: string }[] = [
  { value: "front-first", from: "Word", to: "Definition" },
  { value: "back-first", from: "Definition", to: "Word" },
];

export function StudyDirectionControl({
  value,
  onChange,
  small = false,
  className,
}: {
  value: StudyDirection;
  onChange: (direction: StudyDirection) => void;
  /** The deck list's lighter version. */
  small?: boolean;
  className?: string;
}) {
  const arrows = useRef(new Map<StudyDirection, HTMLSpanElement>());
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const motion = animateStudyDirectionChange(arrows.current.get(value));
    return () => {
      finishMotion(motion);
    };
  }, [value]);

  return (
    <div
      role="group"
      aria-label="Study direction"
      data-testid="study-direction"
      className={cn("grid grid-cols-2 gap-1 rounded-2xl bg-surface-muted p-1", className)}
    >
      {DIRECTIONS.map(({ value: option, from, to }) => {
        const pressed = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option)}
            className={cn(
              "flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition-[background-color,color,box-shadow] duration-150",
              small ? "h-9 px-2.5 text-[13px]" : "h-11 px-2 text-sm",
              pressed
                ? "bg-surface-elevated text-foreground shadow-soft"
                : "text-muted hover:text-foreground"
            )}
          >
            {from}{" "}
            <span
              aria-hidden
              data-testid={`direction-arrow-${option}`}
              className="inline-block"
              ref={(el) => {
                if (el) arrows.current.set(option, el);
                else arrows.current.delete(option);
              }}
            >
              →
            </span>
            <span className="sr-only">to</span>{" "}
            {to}
          </button>
        );
      })}
    </div>
  );
}
