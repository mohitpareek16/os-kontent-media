import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { BrandAssetUploadForm } from "@/components/brand/BrandAssetUploadForm";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Stepper } from "@/components/ui/Stepper";
import { useCreatePod } from "@/hooks/usePods";
import { useUsers } from "@/hooks/useUsers";
import { hasRole, isAdmin } from "@/lib/roles";

const STEPS = ["Pod", "Brand kit"];

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
    <div className="mx-auto max-w-lg space-y-6">
      <div className="border-b border-[var(--border-color)] pb-5">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--primary-light)]">
          <i className="ri-add-box-line" /> Client Onboarding
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--text-main)]">
          Onboard a client
        </h1>
      </div>

      <Stepper steps={STEPS} current={step} />

      {step === 0 && (
        <form
          className="glass-card space-y-3.5 p-5"
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
          <Input
            placeholder="Client / pod name"
            value={podName}
            onChange={(e) => setPodName(e.target.value)}
            required
          />
          <SearchableSelect value={tlId} onChange={setTlId} placeholder="Select a TL" options={tls.map((tl) => ({ value: tl.id, label: `${tl.name} (${tl.role.toUpperCase()})` }))} />
          <Input
            placeholder="Billing currency"
            value={billingCurrency}
            onChange={(e) => setBillingCurrency(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Expected videos/month (optional)"
            value={retainerVolume}
            onChange={(e) => setRetainerVolume(e.target.value)}
          />
          <ErrorNote error={createPod.error} fallback="Could not create that pod." />
          <Button type="submit" disabled={createPod.isPending || !tlId} className="w-full">
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
  );
}
