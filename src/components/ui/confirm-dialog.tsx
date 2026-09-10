// A small confirmation dialog for destructive, irreversible actions.
//
// Deleting a deck removes the only copy this browser holds, so it gets a real
// confirmation step rather than a window.confirm(): the message needs to say
// what is removed and — just as importantly — what is not.

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/primitives";

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
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the confirm button so the dialog is operable from the keyboard,
    // and close on Escape like any other modal.
    confirmRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl sm:inset-x-0"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">{title}</h2>
                <div className="mt-2 space-y-2 text-sm text-muted-foreground">{body}</div>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                ref={confirmRef}
                onClick={onConfirm}
                className="bg-destructive text-white hover:opacity-90"
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
