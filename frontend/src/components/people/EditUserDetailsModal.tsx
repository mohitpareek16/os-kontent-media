import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useUpdateUser } from "@/hooks/useUsers";
import type { User } from "@/types";

/** Mirrors the bounds in `backend/app/services/whatsapp/phone.py`: a number
 * outside them is stored but never dialled, so it is caught here instead of
 * turning up later as "not usable" on the WhatsApp Numbers tab. */
function phoneLooksDialable(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

export function EditUserDetailsModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const update = useUpdateUser();

  const trimmedPhone = phone.trim();
  const phoneInvalid = trimmedPhone !== "" && !phoneLooksDialable(trimmedPhone);
  // Sent only when it changed: an omitted phone means "leave it alone", and an
  // empty string is how the backend is told to clear it.
  const phoneChanged = trimmedPhone !== (user.phone ?? "").trim();

  return (
    <Modal open title={`Edit ${user.name}`} onClose={() => { if (!update.isPending) onClose(); }}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (update.isPending || !name.trim() || phoneInvalid) return;
          update.mutate(
            {
              userId: user.id,
              payload: {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                ...(phoneChanged ? { phone: trimmedPhone } : {}),
              },
            },
            { onSuccess: onClose },
          );
        }}
      >
        <label className="block space-y-1 text-xs font-semibold text-[var(--text-muted)]">
          <span>Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoFocus disabled={update.isPending} />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-[var(--text-muted)]">
          <span>Email</span>
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoCapitalize="none" spellCheck={false} disabled={update.isPending} />
        </label>
        <p className="text-xs text-[var(--text-dim)]">Use the updated email to sign in. The password stays the same.</p>
        <label className="block space-y-1 text-xs font-semibold text-[var(--text-muted)]">
          <span>WhatsApp number</span>
          <Input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="98765 43210" maxLength={32} autoComplete="off" disabled={update.isPending} />
        </label>
        <p className={`text-xs ${phoneInvalid ? "text-rose-400" : "text-[var(--text-dim)]"}`}>
          {phoneInvalid
            ? "That doesn't look like a phone number — it needs 8 to 15 digits."
            : "Work notifications are sent here. A 10-digit number is taken as Indian (+91); add the country code for anywhere else. Leave blank to remove."}
        </p>
        {update.isError && <ErrorNote error={update.error} fallback="Could not update user details." />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={update.isPending} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={update.isPending || !name.trim() || phoneInvalid}>
            {update.isPending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
