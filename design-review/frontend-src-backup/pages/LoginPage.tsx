import { useState } from "react";
// import { Link } from "react-router-dom"; // for the hidden forgot-password link
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLogin } from "@/hooks/useAuth";

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

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin();
  // Set by the API client when a 401 ends the session mid-use.
  const [searchParams] = useSearchParams();
  const expired = searchParams.get("expired") === "1";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--bg-app)] p-4">
      {/* Ambient glow mesh */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-24 left-1/4 h-[420px] w-[420px] rounded-full opacity-40 blur-[110px]"
          style={{ background: "radial-gradient(circle, #7F00FF 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-[-15%] right-[8%] h-[480px] w-[480px] rounded-full opacity-30 blur-[110px]"
          style={{ background: "radial-gradient(circle, #00F2FE 0%, transparent 70%)" }}
        />
      </div>

      <form
        className="glass-card border-glow relative z-10 w-full max-w-sm animate-fade-in-up space-y-5 p-8"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email: email.trim().toLowerCase(), password });
        }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="brand-logo-custom">
            <span className="logo-big-k">K</span>
            <div className="logo-text-stack">
              <span className="logo-ontent">ontent</span>
              <span className="logo-media">Media</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">Sign in to your operations workspace</p>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <i className="ri-mail-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
            <Input
              className="pl-9"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="Email"
              autoFocus
            />
          </div>
          <div className="relative">
            <i className="ri-lock-2-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
            <Input
              className="pl-9 pr-12"
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              aria-label="Password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              className="absolute right-1 top-1/2 flex h-9 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              title={showPassword ? "Hide password" : "Show password"}
            >
              <i className={showPassword ? "ri-eye-off-line" : "ri-eye-line"} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Forgot password — hidden for now; uncomment this block, the Link
            import above and the /forgot-password route in App.tsx to enable. */}
        {/*
        <div className="-mt-2 text-right">
          <Link to="/forgot-password" className="text-xs text-[var(--primary)] hover:underline">
            Forgot password?
          </Link>
        </div>
        */}

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? (
            <>
              <i className="ri-loader-4-line animate-spin" /> Signing in...
            </>
          ) : (
            <>
              <i className="ri-login-circle-line" /> Sign in
            </>
          )}
        </Button>

        {login.isError && (
          <p className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-red-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-red)]">
            <i className="ri-error-warning-line" /> {loginErrorMessage(login.error)}
          </p>
        )}

        {expired && !login.isError && (
          <p className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-amber-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-amber)]">
            <i className="ri-time-line" /> Your session expired — sign in again.
          </p>
        )}
      </form>
    </div>
  );
}
