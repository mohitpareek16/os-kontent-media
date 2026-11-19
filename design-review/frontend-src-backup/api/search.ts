import type { SearchResults } from "@/types";

import { apiClient } from "./client";

/** Jobs, client pods and teammates matching one string, in one request.
 *
 * Scoped server-side to what the caller can already reach — the endpoint
 * composes the same clauses `GET /jobs` and `GET /pods` do, so there is
 * nothing for the browser to re-filter here. */
export async function fetchGlobalSearch(q: string, limit?: number) {
  const { data } = await apiClient.get<SearchResults>("/search", { params: { q, limit } });
  return data;
}
