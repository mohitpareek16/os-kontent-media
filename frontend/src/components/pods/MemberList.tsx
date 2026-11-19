import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Select } from "@/components/ui/Select";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useAddPodMember, usePodMembers, useRemovePodMember } from "@/hooks/usePods";
import { useUsers } from "@/hooks/useUsers";
import type { Pod, PodMember, Role } from "@/types";

const POD_ROLE_OPTIONS = ["tl", "qc", "ve"] as const;

const POD_ROLE_LABEL: Record<string, string> = {
  tl: "Leads this pod",
  qc: "QC on this pod",
  ve: "Edits for this pod",
};

const ACCOUNT_ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  tl: "Team Lead",
  qc: "QC",
  ve: "Editor",
  hr: "HR",
  staff: "Team member",
  fo: "Founder’s Office",
};

export function MemberList({ pod, canManage = false }: { pod: Pod; canManage?: boolean }) {
  const { data: members, isLoading } = usePodMembers(pod.id);
  const { data: users } = useUsers();
  const addMember = useAddPodMember(pod.id);
  const removeMember = useRemovePodMember(pod.id);

  const [userId, setUserId] = useState("");
  const [podRole, setPodRole] = useState<string>("ve");
  const [removing, setRemoving] = useState<PodMember | null>(null);

  const memberIds = new Set(members?.map((m) => m.user_id));
  /** A deactivated teammate can't log in, so offering them here would only
   * produce a 400 — and people already in the pod would produce another.
   * HR is left out for a different reason: there is no pod role for
   * people-ops (docs/04), and putting them in a pod is the one thing that
   * would hand them a view of the work. */
  const addable =
    users?.filter((u) => u.is_active && u.role !== "hr" && !memberIds.has(u.id)) ?? [];

  return (
    <div className="space-y-3">
      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <i className="ri-loader-4-line animate-spin" /> Loading members...
        </p>
      )}

      {!isLoading && members?.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] px-4 py-6 text-center">
          <i className="ri-team-line text-2xl text-[var(--text-dim)]" />
          <p className="mt-1.5 text-sm font-semibold text-[var(--text-main)]">Nobody on this pod yet.</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {canManage
              ? "Add the editors and QC who work this client — pod membership is what gives them the brand brief and SOPs."
              : "The pod's TL adds editors and QC to this roster."}
          </p>
        </div>
      )}

      {members && members.length > 0 && (
        <ul className="divide-y divide-[var(--border-color-subtle)]">
          {members.map((member) => (
            <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--text-main)]">{member.name}</p>
                <p className="truncate text-xs text-[var(--text-muted)]">{member.email}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* Account role and pod role diverge on purpose — an Owner can
                    sit in a pod as its QC, a TL can edit for someone else's
                    client. Showing only one of the two hides that. */}
                <Badge className="bg-[var(--bg-pill)] text-[var(--text-muted)]">
                  <i className="ri-account-circle-line" /> {ACCOUNT_ROLE_LABEL[member.role]}
                </Badge>
                <Badge className="bg-[var(--primary-glow-subtle)] text-[var(--primary-light)]">
                  <i className="ri-briefcase-line" />
                  <span title={POD_ROLE_LABEL[member.pod_role]}>
                    {member.pod_role.toUpperCase()} in pod
                  </span>
                </Badge>
                {member.certified_at && (
                  <Badge className="bg-[var(--accent-green-bg)] text-[var(--accent-green)]">
                    <i className="ri-medal-line" /> Certified
                  </Badge>
                )}
                {canManage && member.user_id !== pod.tl_id && (
                  <Button
                    variant="ghost"
                    title={`Remove ${member.name} from ${pod.name}`}
                    className="hover:bg-[var(--accent-red-bg)]"
                    onClick={() => {
                      removeMember.reset();
                      setRemoving(member);
                    }}
                  >
                    <i className="ri-user-unfollow-line text-[var(--accent-red)]" />
                  </Button>
                )}
                {member.user_id === pod.tl_id && (
                  <span className="text-xs text-[var(--text-dim)]" title="Reassign the pod's TL first">
                    <i className="ri-lock-line" />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!userId) return;
              addMember.mutate({ userId, podRole }, { onSuccess: () => setUserId("") });
            }}
          >
            <SearchableSelect value={userId} onChange={setUserId} placeholder="Add a member..." className="min-w-[10rem] flex-1" options={[{ value: "", label: "Add a member..." }, ...addable.map((u) => ({ value: u.id, label: `${u.name} (${ACCOUNT_ROLE_LABEL[u.role]})` }))]} />
            <Select value={podRole} onChange={(e) => setPodRole(e.target.value)} className="w-28">
              {POD_ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role.toUpperCase()}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={!userId || addMember.isPending}>
              <i className="ri-add-line" /> Add
            </Button>
          </form>

          {addable.length === 0 && users && (
            <p className="text-xs text-[var(--text-dim)]">
              Everyone with an active account is already on this pod.
            </p>
          )}

          <ErrorNote error={addMember.error} fallback="Could not add that teammate to the pod." />
        </>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name ?? ""} from ${pod.name}?`}
        description={
          <>
            They lose access to this client's brand brief, SOPs and do-not list. Their past work and QC
            history stay exactly as they are. Add them back any time.
          </>
        }
        confirmLabel="Remove from pod"
        confirmIcon="ri-user-unfollow-line"
        pending={removeMember.isPending}
        error={removeMember.error}
        errorFallback="Could not remove that member."
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          removeMember.mutate(removing.user_id, { onSuccess: () => setRemoving(null) });
        }}
      />
    </div>
  );
}
