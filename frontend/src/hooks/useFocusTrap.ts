import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps keyboard focus inside a dialog while it is open.
 *
 * On open: remembers the element that had focus, moves focus into the dialog
 * (the first focusable control, or the container itself), and wraps Tab /
 * Shift+Tab at the ends. On close: puts focus back where it was. Escape is
 * handled by the caller (`onClose`), so each dialog keeps its own policy. */
export function useFocusTrap(ref: RefObject<HTMLElement>, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Don't steal focus from an input that autofocused inside the dialog.
    if (!container.contains(document.activeElement)) {
      (focusables()[0] ?? container).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Focus is inside some *other* dialog stacked above this one (a confirm
      // over a drawer): that dialog's own trap handles Tab, not this one.
      if (active && active !== document.body && !container.contains(active)) return;
      if (event.shiftKey && (active === first || active === container || active === document.body)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === container || active === document.body)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [ref, open]);
}
