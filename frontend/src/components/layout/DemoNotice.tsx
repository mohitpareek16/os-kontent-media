import { DEMO_ENABLED } from "@/demo/accounts";

/** Shown only in the demo build: the data is made up, changes live in this
 * browser, and "Reset" puts the sample data back. Renders nothing otherwise. */
export function DemoNotice({ className = "" }: { className?: string }) {
  if (!DEMO_ENABLED) return null;

  const reset = async () => {
    const { resetDemo } = await import("@/demo/server");
    resetDemo();
    window.location.reload();
  };

  return (
    <div
      role="note"
      className={`flex items-start gap-2.5 rounded-xl border border-dashed border-[var(--warn-text)] bg-[var(--warn-bg)] p-3 text-[13px] text-[var(--warn-text)] ${className}`}
    >
      <i className="ri-flask-line mt-0.5 text-lg" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Demo mode</p>
        <p>Sample data only — changes stay in this browser.</p>
        <button type="button" onClick={reset} className="mt-1 font-bold underline underline-offset-2">
          Reset demo data
        </button>
      </div>
    </div>
  );
}
