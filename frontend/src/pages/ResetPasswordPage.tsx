import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { resetPasswordWithToken } from "@/api/auth";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

/** Landing page for the emailed link: `/reset-password?token=...`. */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await resetPasswordWithToken(token, password);
      navigate("/login", { replace: true });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data
        ?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : "Could not reset the password. Use at least 8 characters.",
      );
    } finally {
      setPending(false);
    }
  }

  const longEnough = password.length >= 8;
  const matches = confirm.length > 0 && password === confirm;
  const mismatch = confirm.length > 0 && password !== confirm;
  const eye = (
    <button
      type="button"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? "Hide passwords" : "Show passwords"}
      aria-pressed={showPassword}
      className="absolute right-1 top-1/2 flex h-9 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
    >
      <i className={showPassword ? "ri-eye-off-line" : "ri-eye-line"} aria-hidden="true" />
    </button>
  );
  const rule = (ok: boolean, text: string) => (
    <span className={`flex items-center gap-1.5 text-[13px] ${ok ? "text-[var(--ok-text)]" : "text-[var(--text-dim)]"}`}>
      <i className={ok ? "ri-checkbox-circle-fill" : "ri-checkbox-blank-circle-line"} /> {text}
    </span>
  );

  return (
    <AuthLayout headline="Choose a new password.">
      <form onSubmit={submit}>
        <h1 className="text-[26px] font-bold text-[var(--text-main)]">Set a new password</h1>
        <p className="mb-6 mt-1 text-[15px] text-[var(--text-muted)]">You'll sign in with it straight away.</p>

        {!token ? (
          <p role="alert" className="rounded-lg bg-[var(--bad-bg)] px-3 py-2.5 text-sm font-semibold text-[var(--bad-text)]">
            This reset link is incomplete. Open the link from your email again.
          </p>
        ) : (
          <div className="space-y-4">
            <Field label="New password" htmlFor="new-password">
              <div className="relative">
                <Input
                  id="new-password"
                  className="pr-12"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  autoFocus
                  required
                />
                {eye}
              </div>
            </Field>
            <Field
              label="Confirm password"
              htmlFor="confirm-password"
              error={mismatch ? "The two passwords do not match." : undefined}
            >
              <Input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />
            </Field>
            <div className="grid gap-1" aria-live="polite">
              {rule(longEnough, "At least 8 characters")}
              {rule(matches, "Both fields match")}
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Saving..." : "Set new password"}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-[var(--bad-bg)] px-3 py-2.5 text-sm font-semibold text-[var(--bad-text)]">
            {error}
          </p>
        )}

        <p className="mt-6 text-center">
          <Link to="/login" className="text-sm font-bold text-[var(--primary-text)] hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}