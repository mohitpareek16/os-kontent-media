import { useEffect, useState } from "react";

/** The 300ms every search box in this app waits before it asks the server.
 *
 * The same `useEffect` + `setTimeout` + `clearTimeout` was written out inline
 * in five pages, and a box that fires on every keystroke is one request per
 * character, each one a full scoped query. One hook, so a box added later
 * gets the behaviour by using it rather than by remembering to.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
