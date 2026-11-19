import { useState } from "react";
import { Link } from "react-router-dom";

import { forgotPassword } from "@/api/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/** Asks for an email and always says the same thing afterwards — the server
 * answers 204 whether or not the address has an account, so this page must
 * not hint at it either. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setFailed(false);
    try {
      await forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] p-4">
      <form className="glass-card border-glow w-full max-w-sm space-y-5 p-8" onSubmit={submit}>
        <div className="text-center">
          <h1 className="text-lg font-semibold text-[var(--text-main)]">Forgot password</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Enter your work email and we will send you a reset link.
          </p>
        </div>

        {sent ? (
          <p className="rounded-lg bg-[var(--accent-green-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-green)]">
            If that email has an account, a reset link is on its way. It expires in 30 minutes.
          </p>
        ) : (
          <>
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="Email"
              autoFocus
              required
            />
            <Button type="submit" className="w-full" disabled={pending || !email.trim()}>
              {pending ? "Sending..." : "Send reset link"}
            </Button>
          </>
        )}

        {failed && (
          <p className="rounded-lg bg-[var(--accent-red-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-red)]">
            Something went wrong. Try again in a moment.
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
