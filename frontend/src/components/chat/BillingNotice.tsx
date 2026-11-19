import type { BotErrorCode } from "@/api/chat";

/* The two failures that don't go away on their own.
 *
 * Everything else the bot can hit — a timeout, a rate limit, a malformed
 * gateway response — is worth retrying, so it renders as one red line. These
 * two are not: until someone opens OpenRouter and does something, every
 * question fails identically. "The OpenRouter account is out of credits" in
 * small red text tells the person what broke and not one thing about how to
 * un-break it, and the person reading it is usually the person holding the
 * card.
 *
 * So this states the fix, in order, with the link. The steps are deliberately
 * literal rather than "manage your billing" — this gets read by someone who
 * has never opened OpenRouter and is mid-way through asking about a client.
 */

const CREDITS_URL = "https://openrouter.ai/settings/credits";
const KEYS_URL = "https://openrouter.ai/settings/keys";

interface BillingNoticeProps {
  code: BotErrorCode;
  detail: string;
  /** The floating widget has no room for a numbered list. */
  compact?: boolean;
}

export function BillingNotice({ code, detail, compact = false }: BillingNoticeProps) {
  const outOfCredits = code === "out_of_credits";

  const title = outOfCredits
    ? "Kontent Bot is out of credits"
    : "Kontent Bot's API key isn't working";

  const explanation = outOfCredits
    ? "The OpenRouter account that powers the bot has a zero balance, so every question will fail until it's topped up. Nothing else in the app is affected."
    : "OpenRouter rejected the key this server is using — it's been deleted, rotated, or copied incorrectly. Nothing else in the app is affected.";

  const steps = outOfCredits
    ? [
        <>
          Open{" "}
          <NoticeLink href={CREDITS_URL}>openrouter.ai/settings/credits</NoticeLink> and sign
          in.
        </>,
        <>
          Click <strong>Add Credits</strong> and pay. $5–10 goes a long way — a question costs
          a fraction of a cent.
        </>,
        <>Come back here and ask again. No restart or redeploy is needed.</>,
      ]
    : [
        <>
          Create a fresh key at{" "}
          <NoticeLink href={KEYS_URL}>openrouter.ai/settings/keys</NoticeLink>.
        </>,
        <>
          Put it in the server's <code className="font-mono">.env</code> as{" "}
          <code className="font-mono">OPENROUTER_API_KEY</code>.
        </>,
        <>
          Restart the app container — unlike credits, a key change is only picked up on
          startup.
        </>,
      ];

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-[var(--text-main)]"
    >
      <p className="flex items-center gap-2 font-bold text-amber-500">
        <i className={outOfCredits ? "ri-wallet-3-line" : "ri-key-2-line"} />
        {title}
      </p>
      <p className="mt-1 text-[var(--text-muted)]">{explanation}</p>

      {compact ? (
        <p className="mt-2">
          <NoticeLink href={outOfCredits ? CREDITS_URL : KEYS_URL}>
            {outOfCredits ? "Add credits on OpenRouter" : "Create a new key on OpenRouter"}
          </NoticeLink>
        </p>
      ) : (
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-[var(--text-muted)] marker:font-semibold marker:text-amber-500">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}

      {/* The raw gateway message, kept but demoted — it is what to quote in a
          support thread, and it is not what to read first. */}
      <p className="mt-2 text-xs text-[var(--text-dim)]">OpenRouter said: {detail}</p>
    </div>
  );
}

function NoticeLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-semibold text-[var(--primary-light)] underline underline-offset-2 hover:text-[var(--primary)]"
    >
      {children}
    </a>
  );
}
