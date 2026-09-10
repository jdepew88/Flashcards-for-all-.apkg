/**
 * Joins class names, dropping falsy entries.
 *
 * The CCNA app uses clsx + tailwind-merge here. This project has no design
 * system to merge conflicting utilities for, so the smaller version is enough.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
