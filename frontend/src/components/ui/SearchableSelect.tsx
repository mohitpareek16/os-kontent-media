import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchesSearch } from "@/lib/matchesSearch";

export interface SearchOption {
  value: string;
  label: string;
  searchText?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder: string;
  "aria-label"?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function SearchableSelect({ value, onChange, options, placeholder, disabled, autoFocus, className = "", ...props }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) => matchesSearch(option.label, query, option.searchText));

  useEffect(() => { if (autoFocus) trigger.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId, open]);

  useEffect(() => {
    if (!open) return;
    /* Don't auto-focus the search box on touch screens: the on-screen keyboard
       it opens resizes the viewport, which used to close the list instantly. */
    if (!window.matchMedia("(pointer: coarse)").matches) input.current?.focus();
    const startWidth = window.innerWidth;
    const closeOnResize = () => { if (window.innerWidth !== startWidth) setOpen(false); };
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    const openedAt = Date.now();
    const onScroll = (event: Event) => { if (Date.now() - openedAt > 500 && !popup.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close as EventListener);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", close as EventListener);
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  const show = () => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 192);
    setPosition({
      top: window.innerHeight - rect.bottom >= 250 || rect.top < 250 ? rect.bottom + 4 : Math.max(4, rect.top - 260),
      left: Math.max(4, Math.min(rect.left, window.innerWidth - width - 4)),
      width,
    });
    setQuery("");
    setActive(0);
    setOpen(true);
  };

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
    setActive(0);
    trigger.current?.focus();
  };

  return (
    <div className={`relative min-w-0 ${className}`} ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget as Node)) setOpen(false); }}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={props["aria-label"] ?? placeholder}
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => { if (open) setOpen(false); else show(); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) { event.preventDefault(); show(); }
          if (event.key === "Escape") setOpen(false);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5 text-left text-sm font-medium text-[var(--text-main)] outline-none focus:border-[var(--primary)] disabled:opacity-50"
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <i aria-hidden="true" className="ri-arrow-down-s-line shrink-0" />
      </button>
      {open && createPortal(
        <div ref={popup} style={position} className="fixed z-[100] rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel-solid)] p-1 shadow-xl">
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            aria-label={`Search ${props["aria-label"] ?? placeholder}`}
            placeholder="Search..."
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
              if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, filtered.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
              if (event.key === "Enter" && filtered[active]) { event.preventDefault(); choose(filtered[active].value); }
            }}
            className="mb-1 w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
          />
          <div id={listId} role="listbox" className="max-h-52 overflow-y-auto">
            {filtered.map((option, index) => (
              <button
                key={option.value}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option.value)}
                className={`block w-full truncate rounded px-2 py-2 text-left text-sm text-[var(--text-main)] hover:bg-[var(--bg-pill)] ${index === active ? "bg-[var(--bg-pill)]" : ""}`}
              >
                {option.label}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2 py-3 text-sm text-[var(--text-dim)]">No matches</p>}
          </div>
        </div>, document.body
      )}
    </div>
  );
}
