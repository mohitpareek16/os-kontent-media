import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useCreateUser, useRoleTitles } from "@/hooks/useUsers";
import { dailyBudgetLabel } from "@/lib/qc2";
import { ROLE_META } from "@/lib/roles";
import type { EmploymentType, Role, User } from "@/types";

/** The value of the one Role dropdown. A built-in role is its own name; an
 * existing job title is `title:<id>`; `title:new` opens the text box.
 *
 * One control rather than two, because "what is this person" is one question
 * and asking it twice ("role" then "or a custom role") is how you end up with
 * a Graphic Designer filed as a VE. */
const NEW_TITLE = "title:new";

interface AddTeammateModalProps {
  open: boolean;
  /** Which built-in roles this admin may hand out (`creatableRoles`). The
   * server enforces the same table; this keeps the dropdown from offering a
   * guaranteed 403. */
  roles: Role[];
  /** Whether to offer the lent-TL control. Granting powers is the Owner's,
   * but onboarding somebody who leads their own pods from day one is not a
   * different decision from onboarding them at all — so whoever may create
   * the account may set it here, and only an Owner may change it afterwards. */
  canLendRoles?: boolean;
  title?: string;
  submitLabel?: string;
  onClose: () => void;
  onCreated: (created: User) => void;
}

export function AddTeammateModal({
  open,
  roles,
  canLendRoles = true,
  title = "Add teammate",
  submitLabel = "Add teammate",
  onClose,
  onCreated,
}: AddTeammateModalProps) {
  const createUser = useCreateUser();
  const { data: roleTitles } = useRoleTitles({ enabled: open });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [choice, setChoice] = useState<string>(roles[0] ?? "ve");
  const [newTitle, setNewTitle] = useState("");
  const [secondary, setSecondary] = useState<"" | "tl">("");
  const [employment, setEmployment] = useState<EmploymentType>("full_time");

  /* Reset on *open*, not on close: reopening after a failed attempt shouldn't
   * re-show the old error, and a successful one shouldn't leave the last
   * teammate's details sitting in the form. Keyed on `open` alone —
   * `createUser` changes identity whenever the mutation's own state moves, so
   * having it in the deps would clear the form mid-submit. */
  const reset = createUser.reset;
  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setChoice(roles[0] ?? "ve");
    setNewTitle("");
    setSecondary("");
    setEmployment("full_time");
    reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCustom = choice.startsWith("title:");
  const chosenTitleId = isCustom && choice !== NEW_TITLE ? choice.slice("title:".length) : undefined;

  const submit = () => {
    createUser.mutate(
      {
        name,
        email,
        password,
        phone: phone.trim() || undefined,
        // A custom role is `staff` underneath — the role that grants nothing.
        role: isCustom ? "staff" : choice,
        role_title: choice === NEW_TITLE ? newTitle.trim() : undefined,
        role_title_id: chosenTitleId,
        secondary_role: secondary || undefined,
        // Only meaningful on a QC account, and only sent from one — an
        // editor carrying a stray `part_time` would be a number nothing
        // reads, waiting to confuse whoever finds it.
        employment_type: choice === "qc" ? employment : undefined,
      },
      { onSuccess: onCreated },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-xs text-[var(--text-muted)]">
          This creates their login. Putting them on a client pod is a separate step, done by the
          Owner or that pod's TL.
        </p>

        <div className="relative">
          <i className="ri-user-3-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <Input
            className="pl-9"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div className="relative">
          <i className="ri-mail-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <Input
            className="pl-9"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="relative">
          <i className="ri-phone-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <Input
            className="pl-9"
            placeholder="Phone (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="relative">
          <i className="ri-lock-2-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <Input
            className="pl-9"
            type="password"
            placeholder="Initial password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-[var(--text-dim)]">
            Role
          </label>
          <SearchableSelect value={choice} onChange={setChoice} placeholder="Choose a role or job title" options={[
            ...roles.filter((r) => r !== "staff").map((r) => ({ value: r, label: `${ROLE_META[r].label} — ${ROLE_META[r].blurb}` })),
            ...(roleTitles ?? []).map((t) => ({ value: `title:${t.id}`, label: t.name })),
            { value: NEW_TITLE, label: "+ New job title…" },
          ]} />
        </div>

        {choice === NEW_TITLE && (
          <div>
            <Input
              placeholder="e.g. Graphic Designer, Social Media"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={60}
              required
            />
            <p className="mt-1 text-xs text-[var(--text-dim)]">
              Saved for next time, so the next hire is filed under the same word. A job title
              gives no access on its own.
            </p>
          </div>
        )}

        {/* QC only. The budget is the whole of what this decides, so it is
            asked where it means something and nowhere else — an editor's
            capacity is `max_concurrent_jobs`, a different number with a
            different rule. */}
        {choice === "qc" && (
          <div>
            <label className="mb-1 block text-xs font-bold text-[var(--text-dim)]">
              Working day
            </label>
            <Select
              value={employment}
              onChange={(e) => setEmployment(e.target.value as EmploymentType)}
            >
              <option value="full_time">Full-time — {dailyBudgetLabel("full_time")}</option>
              <option value="part_time">Part-time — {dailyBudgetLabel("part_time")}</option>
            </Select>
            <p className="mt-1 text-xs text-[var(--text-dim)]">
              How much QC2 work routing will send them in a day. Review points depend on the video
              type set by the owner; a part-timer takes at most one podcast a day.
            </p>
          </div>
        )}

        {canLendRoles && (
          <div>
            <label className="mb-1 block text-xs font-bold text-[var(--text-dim)]">
              Extra access
            </label>
            <Select
              value={secondary}
              onChange={(e) => setSecondary(e.target.value as "" | "tl")}
            >
              <option value="">No extra access</option>
              <option value="tl">Also a Team Lead — can run client pods of their own</option>
            </Select>
            <p className="mt-1 text-xs text-[var(--text-dim)]">
              Team Lead reaches only the pods they are given, so this is safe to hand out and
              still means something. An Owner can take it back later.
            </p>
          </div>
        )}

        <ErrorNote
          error={createUser.error}
          fallback="Could not add them — check the email isn't already registered."
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={createUser.isPending}>
            {createUser.isPending ? (
              <>
                <i className="ri-loader-4-line animate-spin" /> Adding…
              </>
            ) : (
              <>
                <i className="ri-user-add-line" /> {submitLabel}
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
