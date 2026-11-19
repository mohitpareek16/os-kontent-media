interface StepperProps {
  steps: string[];
  current: number;
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-sm">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? "step" : undefined}
          className="flex flex-1 items-center gap-2 last:flex-none"
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              index === current
                ? "bg-[var(--primary)] text-white"
                : index < current
                  ? "bg-[var(--ok-bg)] text-[var(--ok-text)]"
                  : "bg-[var(--bg-pill)] text-[var(--text-dim)]"
            }`}
          >
            {index < current ? <i className="ri-check-line" /> : index + 1}
          </span>
          <span
            className={`text-sm font-bold ${
              index === current
                ? "text-[var(--primary-text)]"
                : index < current
                  ? "text-[var(--ok-text)]"
                  : "text-[var(--text-dim)]"
            }`}
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
