// Light ↔ Dark, as one compact control.
//
// The icon shows where a press takes you (a moon while it is light), and the
// accessible name says the same in words. The choice is remembered on this
// device only; see src/lib/theme.ts.

import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-theme-state={theme}
      className={cn(
        "relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-muted",
        "transition-[background-color,color,transform] duration-150 hover:bg-surface-muted hover:text-foreground active:scale-90",
        className
      )}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={theme}
          className="flex"
          initial={{ rotate: -70, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 70, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
        >
          {theme === "dark" ? (
            <Sun className="h-[18px] w-[18px]" strokeWidth={2} />
          ) : (
            <Moon className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
