/**
 * Was the last thing the reader did a key press, or a pointer (finger, mouse)?
 *
 * Consulted only when the control that had focus disappears — pressing Full
 * screen removes the button that was pressed; closing a sheet from inside it
 * leaves focus in a dialog that is animating away. A keyboard user needs focus
 * moved to the control that now does the reverse, so they can carry on from
 * there. A finger does not: focusing a button by script would light a focus
 * ring on it that nobody asked for, and on a phone it would stay lit.
 */

let keyboard = false;

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (event) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboard = true;
    },
    true
  );
  window.addEventListener("pointerdown", () => (keyboard = false), true);
}

export function lastInputWasKeyboard(): boolean {
  return keyboard;
}

/**
 * Focus is stranded. After keyboard input it moves to `target`; after a
 * pointer it is simply released (to the page), so keys reach the study screen
 * again and no ring appears.
 */
export function recoverFocus(target: HTMLElement | null | undefined): void {
  if (keyboard && target) {
    target.focus();
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}
