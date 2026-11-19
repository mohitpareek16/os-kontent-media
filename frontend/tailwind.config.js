/** @type {import('tailwindcss').Config} */

/* The 300-600 shades of these hues resolve to CSS variables (index.css), so
 * the ~300 existing `text-amber-400`-style classes are readable in the light
 * theme (mapped to the 700 shade) and keep their stock look in dark. Opacity
 * modifiers (`bg-amber-500/10`) keep working through <alpha-value>. */
const themed = (hue) =>
  Object.fromEntries(
    [300, 400, 500, 600].map((shade) => [shade, `rgb(var(--c-${hue}-${shade}) / <alpha-value>)`]),
  );

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        role: {
          tl: "#4f46e5",
          ve: "#0d9488",
          qc: "#d97706",
        },
        amber: themed("amber"),
        emerald: themed("emerald"),
        rose: themed("rose"),
        purple: themed("purple"),
        indigo: themed("indigo"),
        teal: themed("teal"),
        sky: themed("sky"),
        violet: themed("violet"),
        cyan: themed("cyan"),
        orange: themed("orange"),
      },
    },
  },
  plugins: [],
};
