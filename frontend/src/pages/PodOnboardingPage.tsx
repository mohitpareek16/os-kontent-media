import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { BrandAssetUploadForm } from "@/components/brand/BrandAssetUploadForm";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Stepper } from "@/components/ui/Stepper";
import { useCreatePod } from "@/hooks/usePods";
import { useUsers } from "@/hooks/useUsers";
import { hasRole, isAdmin, roleLabel } from "@/lib/roles";

const STEPS = ["Client details", "Brand kit"];

export default function PodOnboardingPage() {
  const navigate = useNavigate();
  const { data: users } = useUsers();
  /** The server only accepts an active TL or Owner account as a pod's TL —
   * anything else comes back as a 400 after the form is already filled in. */
  // Anyone who holds the TL role, lent or their own — that is exactly who
  // the server will accept as a pod's `tl_id` (`_require_lead_account`).
  const tls = users?.filter((u) => u.is_active && (hasRole(u, "tl") || isAdmin(u))) ?? [];

  const createPod = useCreatePod();

  const [step, setStep] = useState(0);
  const [podId, setPodId] = useState<string | null>(null);

  const [podName, setPodName] = useState("");
  const [tlId, setTlId] = useState("");
  const [billingCurrency, setBillingCurrency] = useState("INR");
  const [retainerVolume, setRetainerVolume] = useState("");

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,560px)_340px]">
      <div>
        <Stepper steps={STEPS} current={step} />

        {step === 0 && (
          <form
            className="glass-card space-y-5 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!tlId) return;
              createPod.mutate(
                {
                  name: podName,
                  tl_id: tlId,
                  billing_currency: billingCurrency,
                  retainer_volume: retainerVolume ? Number(retainerVolume) : null,
                },
                {
                  onSuccess: (pod) => {
                    setPodId(pod.id);
                    setStep(1);
                  },
                },
              );
            }}
          >
            <Field label="Client name" htmlFor="pod-name">
              <Input
                id="pod-name"
                placeholder="e.g. Northwind Fitness"
                value={podName}
                onChange={(e) => setPodName(e.target.value)}
                required
              />
            </Field>
            <Field label="Team lead" help="Only active Team Leads and Owners can lead a pod.">
              <SearchableSelect value={tlId} onChange={setTlId} placeholder="Select a team lead" options={tls.map((tl) => ({ value: tl.id, label: `${tl.name} · ${roleLabel(tl)}` }))} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Billing currency" htmlFor="pod-currency">
                <Input
                  id="pod-currency"
                  value={billingCurrency}
                  onChange={(e) => setBillingCurrency(e.target.value)}
                />
              </Field>
              <Field label="Videos per month (optional)" htmlFor="pod-retainer">
                <Input
                  id="pod-retainer"
                  type="number"
                  placeholder="e.g. 12"
                  value={retainerVolume}
                  onChange={(e) => setRetainerVolume(e.target.value)}
                />
              </Field>
            </div>
            <ErrorNote error={createPod.error} fallback="Could not create that pod." />
            <div className="flex justify-end">
              <Button type="submit" size="lg" disabled={createPod.isPending || !tlId}>
                {createPod.isPending ? (
                  <>
                    <i className="ri-loader-4-line animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    Next: brand kit <i className="ri-arrow-right-line" />
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      {step === 1 && podId && (
        <div className="glass-card animate-fade-in-up space-y-3.5 p-5">
          <p className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
            <i className="ri-information-line mt-0.5 text-[var(--primary)]" />
            Optional — upload the first brief/SOP now, or skip and add it later from the pod's brand
            asset library.
          </p>
          <BrandAssetUploadForm
            podId={podId}
            layout="stacked"
            submitLabel="Upload and finish"
            onUploaded={() => navigate(`/pods/${podId}/brand-assets`)}
          />
          <Button variant="secondary" className="w-full" onClick={() => navigate("/pods")}>
            Skip for now
          </Button>
        </div>
      )}
      </div>

      <aside className="glass-card bg-[var(--bg-card-hover)] p-5">
        <h2 className="mb-3 text-base font-bold">What this creates</h2>
        {[
          "The client pod, with its team lead",
          "A brand kit for briefs, assets and links",
          "A place to add channels and members",
        ].map((line) => (
          <p key={line} className="mb-2 flex gap-2 text-sm text-[var(--text-muted)]">
            <i className="ri-checkbox-circle-fill text-[var(--ok-text)]" /> {line}
          </p>
        ))}
      </aside>
    </div>
  );
}
