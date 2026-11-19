import { useState } from "react";
import { Link } from "react-router-dom";

import type { Pod } from "@/types";

export function BrandKitHub({ pods, loading }: { pods: Pod[]; loading?: boolean }) {
  const [search, setSearch] = useState("");
  const visible = pods.filter((pod) => pod.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <div className="relative overflow-hidden rounded-[1.75rem] bg-[linear-gradient(115deg,#201038_0%,#4b1681_65%,#7933af_100%)] p-6 text-white sm:p-9">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full border-[30px] border-white/10 sm:h-96 sm:w-96" />
        <div className="relative max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-purple-200"><i className="ri-sparkling-2-line mr-2 text-cyan-300" /> Brand library</p>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">Every client, one clear source of truth.</h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-purple-100/85">Find the brief, assets, links, fonts and change history for a client you work with.</p>
          <div className="relative mt-6 max-w-md"><i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-purple-500" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a client..." aria-label="Find a client brand kit" className="min-h-12 w-full rounded-xl border border-white/20 bg-white px-4 pl-11 text-base font-medium text-slate-900 outline-none placeholder:text-slate-500 focus:border-cyan-300" /></div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2"><div><h3 className="text-lg font-bold text-[var(--text-main)]">Your client kits</h3><p className="text-xs text-[var(--text-muted)]">Only pods you can access appear here.</p></div><span className="rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-bold text-[var(--text-muted)]">{visible.length}</span></div>
      {loading ? <p className="text-sm text-[var(--text-muted)]"><i className="ri-loader-4-line mr-2 animate-spin" /> Loading client kits...</p> : visible.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map((pod) => <Link key={pod.id} to={`/pods/${pod.id}/brand-assets`} className="group flex min-h-48 flex-col justify-between rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 transition-all hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-lg hover:shadow-purple-900/10"><div className="flex items-start justify-between gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary-glow-subtle)] text-xl font-extrabold uppercase text-[var(--primary-light)]">{pod.name.slice(0, 1)}</span><span className="rounded-full bg-[var(--bg-pill)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{pod.status}</span></div><div><h4 className="truncate text-lg font-bold text-[var(--text-main)]">{pod.name}</h4><p className="mt-1 text-xs text-[var(--text-muted)]">Files · links · activity</p></div><span className="flex items-center justify-between border-t border-[var(--border-color-subtle)] pt-3 text-xs font-bold text-[var(--primary-light)]">Open brand kit <i className="ri-arrow-right-up-line text-lg transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span></Link>)}</div> : <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] p-8 text-center text-sm text-[var(--text-muted)]">{pods.length ? "No clients match your search." : "No client pods are available to you yet."}</div>}
    </div>
  );
}
