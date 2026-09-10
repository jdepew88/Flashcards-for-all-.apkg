// Adapted from CCNA Practice Labs — src/components/flashcards/flashcard-options-sheet.tsx.
//
// Changes: the shadcn Button import points at this project's primitives, and a
// "Reset progress" action was added next to "Exit study session" (the CCNA
// build had `resetDeck` in its store but no control bound to it, and a
// standalone visitor has no account page to clear progress from).

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { LogOut, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { FLASHCARD_FONTS, type FlashcardFontId } from "@/lib/fonts";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/stores/prefs-store";

export function FlashcardOptionsSheet({
  open,
  onClose,
  onExit,
  onResetProgress,
  font,
  onFontChange,
  fontSize,
  onFontSizeChange,
}: {
  open: boolean;
  onClose: () => void;
  onExit: () => void;
  onResetProgress: () => void;
  font: FlashcardFontId;
  onFontChange: (font: FlashcardFontId) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
}) {
  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.y > 80) onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="Flashcard reading options"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-border bg-surface-elevated p-5 shadow-2xl"
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
          >
            <motion.div
              className="mx-auto -mt-1 mb-3 flex h-6 w-full cursor-grab touch-none items-center justify-center active:cursor-grabbing"
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={handleDragEnd}
            >
              <div className="h-1.5 w-12 rounded-full bg-border" />
            </motion.div>
            <div className="mx-auto w-full max-w-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Reading options</h2>
                <button
                  onClick={onClose}
                  aria-label="Close options"
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5">
                <p className="text-sm font-medium text-muted-foreground">Font</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {FLASHCARD_FONTS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onFontChange(f.id)}
                      style={{ fontFamily: f.variable }}
                      className={cn(
                        "rounded-xl border px-2 py-2.5 text-sm transition-colors",
                        font === f.id
                          ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
                          : "border-border text-foreground hover:bg-surface-muted"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-medium text-muted-foreground">Text size</p>
                <div className="mt-2 flex items-center gap-3">
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => onFontSizeChange(fontSize - 1)}
                    disabled={fontSize <= MIN_FONT_SIZE}
                    aria-label="Decrease text size"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <div className="flex-1 text-center text-sm text-muted-foreground">{fontSize}px</div>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => onFontSizeChange(fontSize + 1)}
                    disabled={fontSize >= MAX_FONT_SIZE}
                    aria-label="Increase text size"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={onResetProgress}>
                  <RotateCcw className="h-4 w-4" />
                  Reset progress
                </Button>
                <Button variant="outline" onClick={onExit}>
                  <LogOut className="h-4 w-4" />
                  Exit study session
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
