export function matchesSearch(label: string, query: string, extra = ""): boolean {
  const search = query.trim().toLocaleLowerCase();
  if (!search) return true;
  const name = label.toLocaleLowerCase();
  const initials = (name.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word[0]).join("");
  return name.includes(search) || extra.toLocaleLowerCase().includes(search) || initials.includes(search);
}
