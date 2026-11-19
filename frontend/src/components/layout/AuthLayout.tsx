import type { ReactNode } from "react";

import { BrandMark } from "@/components/layout/BrandMark";

/** The signed-out pages' shell (reset / forgot password): a dark brand panel on
 * desktop, a plain centred form below 1024px. LoginPage has the same shape with
 * its own, longer pitch. */
export function AuthLayout({ headline, children }: { headline: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] bg-[var(--bg-app)] lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#1A1528] p-12 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(127,0,255,0.55) 0%, transparent 70%)" }}
        />
        <div className="relative">
          <BrandMark light />
        </div>
        <h2 className="relative max-w-[420px] text-4xl font-bold leading-[1.15]">{headline}</h2>
        <p className="relative text-[13px] text-[#9A94B5]">© Kontent Media</p>
      </div>
      <div className="flex items-center justify-center bg-[var(--bg-card)] p-6 sm:p-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
