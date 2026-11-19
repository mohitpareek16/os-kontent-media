import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { usePods } from "@/hooks/usePods";

interface PodSwitcherProps {
  /** null means "All Clients" */
  value: string | null;
  onChange: (podId: string | null) => void;
}

export function PodSwitcher({ value, onChange }: PodSwitcherProps) {
  const { data: pods, isLoading } = usePods();

  if (isLoading || !pods) return null;

  return (
    <SearchableSelect className="w-48" value={value ?? ""} onChange={(id) => onChange(id || null)} placeholder="All Clients" options={[{ value: "", label: "All Clients" }, ...pods.map((pod) => ({ value: pod.id, label: pod.name }))]} />
  );
}
