import { useState } from "react";
import { Link } from "react-router-dom";

import { forgotPassword } from "@/api/auth";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
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
    <AuthLayout headline="Forgot your password? It happens.">
      <form onSubmit={submit}>
        <h1 className="text-[26px] font-bold text-[var(--text-main)]">Forgot password</h1>
        <p className="mb-6 mt-1 text-[15px] text-[var(--text-muted)]">
          Enter your work email and we will send you a reset link.
        </p>

        {sent ? (
          <p
            role="status"
            className="rounded-lg bg-[var(--ok-bg)] px-3 py-2.5 text-sm font-semibold text-[var(--ok-text)]"
          >
            If that email has an account, a reset link is on its way. It expires in 30 minutes.
          </p>
        ) : (
          <div className="space-y-5">
            <Field label="Work email" htmlFor="forgot-email">
              <Input
                id="forgot-email"
                type="email"
                placeholder="name@kontent.media"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
              />
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={pending || !email.trim()}>
              {pending ? "Sending..." : "Send reset link"}
            </Button>
          </div>
        )}

        {failed && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-[var(--bad-bg)] px-3 py-2.5 text-sm font-semibold text-[var(--bad-text)]"
          >
            Something went wrong. Try again in a moment.
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
