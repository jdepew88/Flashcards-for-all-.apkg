// "Add to Home Screen" help.
//
// An iPhone browser tab cannot hide the browser's own address bar and toolbars
// — iPhone browsers give pages no Fullscreen API. A site opened from the Home
// Screen can: it runs as a standalone web app (public/manifest.webmanifest).
// This sheet says how, without claiming Safari is the only way (other iOS
// browsers offer Add to Home Screen through the same system Share menu), and
// says plainly what happens to saved decks: the Home Screen app keeps its own
// storage, so decks do not follow the reader there by themselves.
//
// A help sheet, not a tutorial: nothing blocks studying, Escape or a tap
// outside closes it, and focus goes back to whatever opened it.

import { useEffect, useId, useRef, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { trapFocus } from "@/lib/focus";
import { recoverFocus } from "@/lib/input-modality";

export function HomeScreenHelp({
  open,
  onClose,
  fallbackFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** Where focus goes if whatever opened the sheet is gone (the one-time tip). */
  fallbackFocus?: RefObject<HTMLElement | null>;
}) {
  const fallbackRef = useRef(fallbackFocus);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
    fallbackRef.current = fallbackFocus;
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
        trapFocus(event, dialogRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Never leave focus inside a dialog that is animating away: keys typed
      // there would be ignored by the study screen until it finished.
      // (`previous` is <body> when the control that opened it unmounted in
      // the same moment, as the one-time tip's "How" does.)
      if (previous && previous !== document.body && previous.isConnected) previous.focus();
      else recoverFocus(fallbackRef.current?.current);
    };
  }, [open]);

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
          <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={bodyId}
              className="pointer-events-auto max-h-[88dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[1.75rem] border-t border-border bg-surface-elevated px-5 pt-5 shadow-float sm:rounded-3xl sm:border"
              style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
              initial={{ y: 28, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 28, opacity: 0 }}
              transition={{ type: "spring", damping: 34, stiffness: 380 }}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <SquarePlus className="h-5 w-5" />
                </span>
                <h2 id={titleId} className="min-w-0 flex-1 pt-1.5 text-lg font-semibold leading-snug tracking-tight">
                  Add Flashcards for All to your Home Screen
                </h2>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p id={bodyId} className="mt-3 text-[15px] leading-relaxed text-muted">
                For the most screen space on iPhone, open Flashcards for All from your Home Screen.
                It opens as its own app, without the browser&apos;s address bar and toolbars.
              </p>

              <ol className="mt-4 space-y-3 text-[15px] leading-relaxed">
                <Step n={1}>
                  Open your browser&apos;s <strong className="font-semibold">Share</strong> menu{" "}
                  <Share aria-hidden className="inline h-4 w-4 -translate-y-px text-muted" />. In
                  Safari it is the Share button; in Chrome and other browsers it is in the address
                  bar or the ⋯ menu.
                </Step>
                <Step n={2}>
                  Choose <strong className="font-semibold">Add to Home Screen</strong>. You may need
                  to scroll down the list of actions.
                </Step>
                <Step n={3}>Open Flashcards for All from its new icon.</Step>
              </ol>

              <div className="mt-5 rounded-2xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-relaxed">
                <p className="font-semibold text-foreground">Your decks don&apos;t move over by themselves.</p>
                <p className="mt-1 text-muted">
                  Decks are stored only on this device, in the browser you imported them in. The
                  Home Screen app keeps its own separate storage, so you may need to import your{" "}
                  <code className="rounded bg-surface-muted px-1 py-0.5 text-[0.85em]">.apkg</code>{" "}
                  deck again there. Nothing is uploaded either way.
                </p>
              </div>

              <Button className="mt-5 w-full" onClick={onClose}>
                Got it
              </Button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold tabular-nums text-muted"
      >
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
