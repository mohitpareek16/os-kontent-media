import { useEffect, useState } from "react";

/** `true` while the media query matches; updates live (rotate a phone, resize
 * a window). Safe on the server / in tests where `matchMedia` is missing. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches),
  );

  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Phone-sized screens get the app layout (bottom tabs); anything wider keeps
 * the desktop sidebar. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
