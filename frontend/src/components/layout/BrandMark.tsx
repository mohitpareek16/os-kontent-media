/** The Kontent Media logo: a solid primary "K" tile and the wordmark. (The old
 * gradient K started at pure white and vanished on the light theme.) */
export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <span className="brand-mark">
      <span className="brand-mark__k" aria-hidden="true">
        K
      </span>
      <span className="brand-mark__text" style={light ? { color: "#fff" } : undefined}>
        Kontent
        <small style={light ? { color: "#B8B0D6" } : undefined}>Media</small>
      </span>
    </span>
  );
}
