import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Height in px that makes an element run from where it sits down to the
 * bottom of the window.
 *
 * A kanban board that is only as tall as its tallest column looks broken when
 * the columns are empty — seven headers floating over a page of blank space.
 * The board's top edge isn't a constant we can bake into a `calc(100vh - X)`
 * either: the toolbar above it wraps at narrow widths, and the impersonation
 * banner adds its own offset. So we measure the element's position in the
 * document and hand back what's left of the viewport.
 *
 * Returns a ref to attach to the element and the height to apply to it. The
 * height is `undefined` until the first measurement, and never drops below
 * `minHeight` so a short window still gets a usable board.
 */
export function useFillViewportHeight<T extends HTMLElement>(
  { enabled = true, minHeight = 320, bottomGap = 24 } = {},
) {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState<number>();

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    /* Document-relative top, so a measurement taken while the page happens to
     * be scrolled reports the same number as one taken at the top. */
    const top = el.getBoundingClientRect().top + window.scrollY;
    setHeight(Math.max(minHeight, window.innerHeight - top - bottomGap));
  }, [minHeight, bottomGap]);

  useLayoutEffect(() => {
    if (!enabled) {
      setHeight(undefined);
      return;
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, measure]);

  /* Anything above the board changing height moves it — filter chips wrapping
   * onto a second row, the status cards reflowing. Watching the body catches
   * all of it without every caller having to know what its own layout does. */
  useEffect(() => {
    if (!enabled || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [enabled, measure]);

  return [ref, height] as const;
}
