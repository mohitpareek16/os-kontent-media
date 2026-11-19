import type { SelectHTMLAttributes } from "react";

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select
      className={`h-11 w-full appearance-none rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-input)] bg-[url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2020%2020'%20fill='%238F3EFF'%3E%3Cpath%20fill-rule='evenodd'%20d='M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z'%20clip-rule='evenodd'/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_0.7rem_center] bg-no-repeat pl-3.5 pr-9 text-[15px] font-medium text-[var(--text-main)] outline-none transition-colors focus:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
