// A confirmation dialog for destructive, irreversible actions.
//
// Deleting a deck removes the only copy this browser holds, so it gets a real
// confirmation step rather than window.confirm(): the message needs to say
// what is removed and — just as importantly — what is not.
//
// Focus lands on Cancel, not on the destructive button, so a stray Enter
// cannot delete anything. Tab stays inside the dialog, Escape cancels, and
// focus returns to whatever opened it.

import { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { trapFocus } from "@/lib/focus";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
      } else if (event.key === "Tab") {
        trapFocus(event, dialogRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
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
            onClick={onCancel}
          />
          <div
            className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <motion.div
              ref={dialogRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={bodyId}
              className="pointer-events-auto w-full max-w-md rounded-3xl border border-border bg-surface-elevated p-5 shadow-float sm:p-6"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ type: "spring", damping: 30, stiffness: 380 }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-danger-soft text-danger">
                <Trash2 className="h-5 w-5" />
              </span>
              <h2 id={titleId} className="mt-4 text-lg font-semibold tracking-tight">
                {title}
              </h2>
              <div id={bodyId} className="mt-2 space-y-2 text-[15px] leading-relaxed text-muted">
                {body}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={onConfirm}>
                  {confirmLabel}
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
