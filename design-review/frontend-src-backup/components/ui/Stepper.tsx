interface StepperProps {
  steps: string[];
  current: number;
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-sm">
      {steps.map((step, index) => (
        <li key={step} className="flex flex-1 items-center gap-2 last:flex-none">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
              index === current
                ? "bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] text-white shadow-md shadow-[var(--primary-glow-subtle)]"
                : index < current
                  ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)]"
                  : "bg-[var(--bg-pill)] text-[var(--text-dim)]"
            }`}
          >
            {index < current ? <i className="ri-check-line" /> : index + 1}
          </span>
          <span
            className={`text-xs font-semibold ${index === current ? "text-[var(--text-main)]" : "text-[var(--text-dim)]"}`}
          >
            {step}
          </span>
          {index < steps.length - 1 && (
            <span className="mx-1 h-px flex-1 bg-[var(--border-color)]" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}
