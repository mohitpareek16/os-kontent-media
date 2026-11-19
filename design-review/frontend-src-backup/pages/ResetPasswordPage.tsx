import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { resetPasswordWithToken } from "@/api/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/** Landing page for the emailed link: `/reset-password?token=...`. */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] p-4">
      <form className="glass-card border-glow w-full max-w-sm space-y-5 p-8" onSubmit={submit}>
        <div className="text-center">
          <h1 className="text-lg font-semibold text-[var(--text-main)]">Choose a new password</h1>
        </div>

        {!token ? (
          <p className="rounded-lg bg-[var(--accent-red-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-red)]">
            This reset link is incomplete. Open the link from your email again.
          </p>
        ) : (
          <>
            <Input
              type="password"
              placeholder="New password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              autoFocus
              required
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Saving..." : "Set new password"}
            </Button>
          </>
        )}

        {error && (
          <p className="rounded-lg bg-[var(--accent-red-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-red)]">
            {error}
          </p>
        )}

        <p className="text-center text-xs">
          <Link to="/login" className="text-[var(--primary)] hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
