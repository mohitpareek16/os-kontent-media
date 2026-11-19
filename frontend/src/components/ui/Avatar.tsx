import { initialsOf } from "@/lib/roles";

type AvatarSize = 20 | 24 | 26 | 28 | 32 | 36 | 40 | 44 | 56;

interface AvatarProps {
  name: string;
  size?: AvatarSize;
  /** Rounded square instead of a circle (pods / clients). */
  square?: boolean;
  /** Overrides the initials, e.g. a single client letter. */
  text?: string;
  className?: string;
}

/** Initials in a neutral tint. One style for every person and client; roles
 * are shown with a labelled chip, not with a colour (stage colours already
 * own teal / amber / indigo). */
export function Avatar({ name, size = 32, square = false, text, className = "" }: AvatarProps) {
  return (
    <span
      title={name}
      aria-hidden={text ? undefined : true}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      className={`avatar-circle ${square ? "rounded-[10px]" : "rounded-full"} ${className}`}
    >
      {text ?? initialsOf(name)}
    </span>
  );
}
