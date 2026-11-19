import { useUpdateChecklist } from "@/hooks/useJobs";
import type { Job } from "@/types";

export function ChecklistToggle({ job }: { job: Job }) {
  const updateChecklist = useUpdateChecklist(job.id);

  return (
    <div className="glass-card space-y-2.5 p-4 text-sm">
      <p className="flex items-center gap-2 font-bold text-[var(--text-main)]">
        <i className="ri-list-check-3 text-[var(--primary)]" /> Delivery checklist
      </p>
      <label className="flex items-center gap-2 text-[var(--text-main)]">
        <input
          type="checkbox"
          checked={job.client_sheet_ok}
          onChange={(e) => updateChecklist.mutate({ client_sheet_ok: e.target.checked })}
          className="h-4 w-4 rounded accent-[var(--primary)]"
        />
        Client sheet updated
      </label>
      <label className="flex items-center gap-2 text-[var(--text-main)]">
        <input
          type="checkbox"
          checked={job.ops_tracker_ok}
          onChange={(e) => updateChecklist.mutate({ ops_tracker_ok: e.target.checked })}
          className="h-4 w-4 rounded accent-[var(--primary)]"
        />
        Ops tracker updated
      </label>
      <p className="text-xs text-[var(--text-dim)]">
        Both must be checked before this job can be delivered — see docs/03-data-model.md.
      </p>
    </div>
  );
}
