/** "Somebody called this urgent."
 *
 * Renders nothing when the job isn't rush, so it can sit unconditionally
 * beside the video-type chip on every row without a ternary at each site.
 *
 * The tooltip says what the flag actually buys, because the word does not.
 * Rush means QC2 routing may place the job on a reviewer who has no points
 * left rather than leaving it unrouted (docs/12-qc2-load-model.md) — it is not
 * a priority sort, it does not move the job up a queue, and it does not change
 * what the review costs. Left unexplained, it becomes the flag everybody puts
 * on everything, at which point it means nothing at all.
 */
export function RushBadge({ rush, compact }: { rush: boolean; compact?: boolean }) {
  if (!rush) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 font-bold uppercase tracking-wide text-rose-400"
      title="Marked urgent: QC2 routing may place this on a reviewer who is already out of points, rather than leaving it unrouted. It does not jump the queue."
    >
      <i className="ri-flashlight-fill" />
      {compact ? "" : "Rush"}
    </span>
  );
}
