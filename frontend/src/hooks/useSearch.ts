import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchGlobalSearch } from "@/api/search";

/** One character matches half the workspace and tells the user nothing, so
 * the box waits for two before it asks. Exported because the empty state has
 * to say the same number the query enforces. */
export const MIN_QUERY_LENGTH = 2;

/**
 * The header's global search.
 *
 * `keepPreviousData` on purpose: the results panel keeps showing the last
 * answer while the next one is in flight, so typing a fourth character
 * doesn't blank the list and jump everything under the cursor. The debounce
 * belongs to the caller (`useDebouncedValue`) — this hook takes the query it
 * should actually run.
 */
export function useGlobalSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", trimmed],
    queryFn: () => fetchGlobalSearch(trimmed),
    enabled: trimmed.length >= MIN_QUERY_LENGTH,
    placeholderData: keepPreviousData,
    /* A job that moved a stage ago is still the job you were looking for —
     * results are a way to navigate, not a live view of the pipeline. */
    staleTime: 30_000,
  });
}
