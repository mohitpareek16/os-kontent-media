import { useState } from "react";
// import { Link } from "react-router-dom"; // for the hidden forgot-password link
import { useSearchParams } from "react-router-dom";

import { BrandMark } from "@/components/layout/BrandMark";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useLogin } from "@/hooks/useAuth";
import { DemoNotice } from "@/components/layout/DemoNotice";
import { DEMO_ACCOUNTS, DEMO_ENABLED } from "@/demo/accounts";

/** A deactivated account gets a 403 with a real explanation from the server;
 * anything else is a wrong password. Showing "invalid credentials" to someone
 * whose account was switched off sends them hunting for a typo that isn't
 * there. */
function loginErrorMessage(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } })
    ?.response;
  if (response?.status === 403 && typeof response.data?.detail === "string") {
    return response.data.detail;
  }
  return "Invalid credentials";
}

const PIPELINE_STAGES = ["Intake", "Assigned", "Editing", "QC 1", "QC 2", "Final check", "Delivered"];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin();
  // Set by the API client when a 401 ends the session mid-use.
  const [searchParams] = useSearchParams();
  const expired = searchParams.get("expired") === "1";

  return (
    <div className="grid min-h-[100dvh] bg-[var(--bg-app)] lg:grid-cols-2">
      {/* Brand panel — desktop only. The one place a soft glow is allowed. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#1A1528] p-14 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(127,0,255,0.55) 0%, transparent 70%)" }}
        />
        <div className="relative">
          <BrandMark light />
        </div>
        <div className="relative">
          <h2 className="max-w-[520px] text-[44px] font-bold leading-[1.1]">
            Every video, from brief to delivery.
          </h2>
          <p className="mt-4 max-w-[480px] text-base text-[#C4BFD9]">
            Assign editors, run two-pass QC and keep every client on deadline from one workspace.
          </p>
          <ul className="mt-8 flex flex-wrap gap-1.5" aria-label="Pipeline stages">
            {PIPELINE_STAGES.map((stage) => (
              <li
                key={stage}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-[#E9E5FA]"
              >
                {stage}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[13px] text-[#9A94B5]">© Kontent Media</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center bg-[var(--bg-card)] p-6 sm:p-10">
        <form
          className="w-full max-w-[380px]"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate({ email: email.trim().toLowerCase(), password });
          }}
        >
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <h1 className="text-[28px] font-bold text-[var(--text-main)]">Welcome back</h1>
          <p className="mb-7 mt-1 text-[15px] text-[var(--text-muted)]">
            Sign in to your operations workspace.
          </p>

          <div className="space-y-4">
            <Field label="Email" htmlFor="login-email">
              <div className="relative">
                <i className="ri-mail-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
                <Input
                  id="login-email"
                  className="pl-10"
                  type="email"
                  placeholder="name@kontent.media"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="login-password">
              <div className="relative">
                <i className="ri-lock-2-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-[var(--text-dim)]" />
                <Input
                  id="login-password"
                  className="pl-10 pr-12"
                  type={showPassword ? "text" : "password"}
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  className="absolute right-1 top-1/2 flex h-9 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  <i className={showPassword ? "ri-eye-off-line" : "ri-eye-line"} aria-hidden="true" />
                </button>
              </div>
            </Field>
          </div>

          {/* Forgot password — hidden for now; uncomment this block, the Link
              import above and the /forgot-password route in App.tsx to enable.
              Until then, tell people how to get back in. */}
          {/*
          <div className="mt-2 text-right">
            <Link to="/forgot-password" className="text-sm font-bold text-[var(--primary-text)] hover:underline">
              Forgot password?
            </Link>
          </div>
          */}

          <Button type="submit" size="lg" className="mt-6 w-full" disabled={login.isPending}>
            {login.isPending ? (
              <>
                <i className="ri-loader-4-line animate-spin" /> Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>

          {login.isError && (
            <p
              role="alert"
              className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--bad-bg)] px-3 py-2.5 text-sm font-semibold text-[var(--bad-text)]"
            >
              <i className="ri-error-warning-fill" /> {loginErrorMessage(login.error)}
            </p>
          )}

          {expired && !login.isError && (
            <p
              role="status"
              className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--warn-bg)] px-3 py-2.5 text-sm font-semibold text-[var(--warn-text)]"
            >
              <i className="ri-time-line" /> Your session expired — sign in again.
            </p>
          )}

          {DEMO_ENABLED && (
            <div className="mt-6 space-y-2">
              <DemoNotice />
              <p className="pt-1 text-[13px] font-bold text-[var(--text-muted)]">Try it as…</p>
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  disabled={login.isPending}
                  onClick={() => login.mutate({ email: account.email, password: "demo" })}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-4 py-3 text-left transition-colors hover:border-[var(--primary)]"
                >
                  <span>
                    <span className="block text-sm font-bold text-[var(--text-main)]">{account.label}</span>
                    <span className="block text-xs text-[var(--text-dim)]">
                      {account.name} · {account.blurb}
                    </span>
                  </span>
                  <i className="ri-arrow-right-line text-[var(--primary-text)]" />
                </button>
              ))}
            </div>
          )}
          <p className="mt-5 text-center text-xs text-[var(--text-dim)]">
            Trouble signing in? Ask your team lead to reset your password.
          </p>
        </form>
      </div>
    </div>
  );
}
