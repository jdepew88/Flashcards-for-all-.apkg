// A compact overflow ("⋯") menu for secondary actions.
//
// Follows the ARIA menu-button pattern: the trigger announces the popup and its
// state, focus moves into the menu on open, arrow keys / Home / End move
// between items, Escape closes and returns focus, and a press outside closes.
// It opens upward when there is not enough room below.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  tone?: "danger";
  onSelect: () => void;
}

export function OverflowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function toggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      setOpenUp(below < 24 + items.length * 48 && rect.top > below);
    }
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const elements = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => elements[(i + elements.length) % elements.length]?.focus();

    if (event.key === "ArrowDown") focusAt(index + 1);
    else if (event.key === "ArrowUp") focusAt(index - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(elements.length - 1);
    else if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
      return;
    } else return;

    event.preventDefault();
    event.stopPropagation();
  }

  function select(item: MenuItem) {
    // Focus goes back to the trigger first, so anything the item opens (a
    // confirmation dialog) returns focus somewhere sensible when it closes.
    triggerRef.current?.focus();
    setOpen(false);
    item.onSelect();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-[background-color,color,transform] duration-150",
          "hover:bg-surface-muted hover:text-foreground active:scale-95",
          open && "bg-surface-muted text-foreground"
        )}
      >
        <Ellipsis className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            initial={{ opacity: 0, scale: 0.96, y: openUp ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ duration: 0.14, ease: [0.2, 0.7, 0.2, 1] }}
            className={cn(
              "absolute right-0 z-30 min-w-[14rem] rounded-2xl border border-border bg-surface-elevated p-1.5 shadow-float",
              openUp ? "bottom-full mb-1.5 origin-bottom-right" : "top-full mt-1.5 origin-top-right"
            )}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => select(item)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium outline-none transition-colors",
                  "hover:bg-surface-muted focus:bg-surface-muted",
                  item.tone === "danger" ? "text-danger" : "text-foreground"
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
