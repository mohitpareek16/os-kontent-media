import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartSpec } from "@/types";

/* A chart the bot drew.
 *
 * The spec arrives already validated (every series holds one number per
 * label, series count is capped at 8, a pie carries exactly one series), so
 * nothing here re-checks shape — see services/ai/tools/charts.py. What this
 * file owns is how a chart *looks*, which is the part that has to match the
 * rest of the app in both themes.
 *
 * Series colors come from the eight `--series-N` tokens in index.css and are
 * assigned in fixed order, never cycled: series 3 is slot 3 whatever it is
 * called, so two charts in one answer use consistent colors and no chart
 * repaints when a series is dropped.
 */

const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

/* Three of the light-mode slots sit under 3:1 against a white card. The
 * palette allows that only if the exact values stay reachable as text —
 * hence the table toggle below, which is not a nice-to-have. */

const AXIS_TICK = { fill: "var(--text-dim)", fontSize: 11 };

function formatValue(value: number, format: ChartSpec["value_format"]): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  const text = rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (format === "percent") return `${text}%`;
  if (format === "days") return `${text}d`;
  if (format === "points") return `${text} pts`;
  return text;
}

/** A date label renders as "12 Mar"; anything else is a name and passes
 * through untouched. Charts here are mostly time series, and a column of
 * full ISO dates costs more width than it carries. */
function formatLabel(label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  const date = new Date(`${label}T00:00:00`);
  if (Number.isNaN(date.getTime())) return label;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

interface ChartBlockProps {
  spec: ChartSpec;
  /** The floating widget is ~320px of usable width. A chart keeps its full
   * height there only by eating the whole panel, so it gets a shorter one. */
  compact?: boolean;
}

export function ChartBlock({ spec, compact = false }: ChartBlockProps) {
  const [showTable, setShowTable] = useState(false);

  const series = spec.series.slice(0, SERIES_COLORS.length);
  // Recharts wants row-per-category; the spec is series-per-row because that
  // is the shape a model can fill in without transposing in its head.
  const rows = spec.labels.map((label, index) => {
    const row: Record<string, string | number> = { label: formatLabel(label) };
    for (const item of series) row[item.name] = item.values[index] ?? 0;
    return row;
  });

  // A legend is the dependable identity channel, so it is always on for two
  // or more series. One series needs none — the title already names it.
  const showLegend = series.length > 1;

  const tooltip = (
    <Tooltip
      cursor={{ fill: "var(--bg-pill)" }}
      contentStyle={{
        background: "var(--bg-card-hover)",
        border: "1px solid var(--border-color)",
        borderRadius: 8,
        fontSize: 11,
        color: "var(--text-main)",
        boxShadow: "var(--shadow-card)",
      }}
      labelStyle={{ color: "var(--text-muted)", fontWeight: 600, marginBottom: 2 }}
      formatter={(value) => formatValue(Number(value), spec.value_format)}
    />
  );

  const legend = showLegend ? (
    <Legend
      verticalAlign="bottom"
      height={28}
      iconType="circle"
      iconSize={8}
      // Legend text wears a text token, never the series color — a light
      // hue is illegible as text. The dot beside it carries identity.
      formatter={(value) => (
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{value}</span>
      )}
    />
  ) : null;

  const grid = (
    <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />
  );
  const axes = (
    <>
      <XAxis
        dataKey="label"
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={{ stroke: "var(--chart-grid)" }}
        interval="preserveStartEnd"
        minTickGap={12}
      />
      <YAxis
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        width={compact ? 32 : 44}
        tickFormatter={(value) => formatValue(Number(value), spec.value_format)}
      />
    </>
  );

  return (
    <figure className="mt-2 rounded-lg border border-[var(--border-color-subtle)] bg-[var(--bg-card)] p-3">
      <figcaption className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-[var(--text-main)]">{spec.title}</p>
          {spec.y_label && (
            <p className="text-xs text-[var(--text-dim)]">
              {spec.y_label}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((open) => !open)}
          className="shrink-0 rounded-full border border-[var(--border-color)] px-2 py-0.5 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--primary)] hover:text-[var(--text-main)]"
        >
          <i className={showTable ? "ri-bar-chart-2-line" : "ri-table-line"} />{" "}
          {showTable ? "Chart" : "Table"}
        </button>
      </figcaption>

      {showTable ? (
        <ChartTable spec={spec} series={series} />
      ) : (
        <div className={`${compact ? "h-40" : "h-56"} w-full`}>
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        </div>
      )}

      {spec.note && <p className="mt-2 text-xs text-[var(--text-dim)]">{spec.note}</p>}
    </figure>
  );

  function renderChart() {
    const margin = { top: 8, right: 8, bottom: 0, left: 0 };

    if (spec.chart_type === "pie" || spec.chart_type === "donut") {
      // One series only, enforced server-side. Slices are the labels, so
      // color runs down the palette per slice rather than per series.
      const slices = spec.labels.map((label, index) => ({
        name: formatLabel(label),
        value: series[0]?.values[index] ?? 0,
      }));
      return (
        <PieChart margin={margin}>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius={spec.chart_type === "donut" ? "52%" : 0}
            outerRadius="78%"
            paddingAngle={1}
            // 2px of surface between slices — the gap does the separating,
            // never a border drawn around the mark.
            stroke="var(--bg-card)"
            strokeWidth={2}
          >
            {slices.map((slice, index) => (
              <Cell key={slice.name} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
            ))}
          </Pie>
          {tooltip}
          <Legend
            verticalAlign="bottom"
            height={28}
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{value}</span>
            )}
          />
        </PieChart>
      );
    }

    if (spec.chart_type === "line") {
      return (
        <LineChart data={rows} margin={margin}>
          {grid}
          {axes}
          {tooltip}
          {legend}
          {series.map((item, index) => (
            <Line
              key={item.name}
              type="monotone"
              dataKey={item.name}
              stroke={SERIES_COLORS[index]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              // The ring is surface-colored so dots stay legible where two
              // lines cross, and it doubles the hover target.
              dot={{ r: 3, fill: SERIES_COLORS[index], stroke: "var(--bg-card)", strokeWidth: 2 }}
              activeDot={{ r: 5, stroke: "var(--bg-card)", strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      );
    }

    if (spec.chart_type === "area") {
      return (
        <AreaChart data={rows} margin={margin}>
          <defs>
            {series.map((item, index) => (
              <linearGradient key={item.name} id={`fill-${index}`} x1="0" y1="0" x2="0" y2="1">
                {/* A wash, not a saturated block — the line carries the
                    signal, the fill only says "this is the same series". */}
                <stop offset="0%" stopColor={SERIES_COLORS[index]} stopOpacity={0.18} />
                <stop offset="100%" stopColor={SERIES_COLORS[index]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {grid}
          {axes}
          {tooltip}
          {legend}
          {series.map((item, index) => (
            <Area
              key={item.name}
              type="monotone"
              dataKey={item.name}
              stroke={SERIES_COLORS[index]}
              strokeWidth={2}
              fill={`url(#fill-${index})`}
              activeDot={{ r: 5, stroke: "var(--bg-card)", strokeWidth: 2 }}
            />
          ))}
        </AreaChart>
      );
    }

    const stacked = spec.chart_type === "stacked_bar";
    return (
      <BarChart data={rows} margin={margin} barCategoryGap="20%">
        {grid}
        {axes}
        {tooltip}
        {legend}
        {series.map((item, index) => (
          <Bar
            key={item.name}
            dataKey={item.name}
            stackId={stacked ? "stack" : undefined}
            fill={SERIES_COLORS[index]}
            // Capped rather than filling the band: the leftover is air, not
            // wasted space.
            maxBarSize={24}
            // Rounded at the data end, square at the baseline. In a stack the
            // data end is the top of the last series, so only that one is
            // rounded — rounding every segment would put a curve in the
            // middle of a bar and read as a gap that isn't there.
            radius={!stacked || index === series.length - 1 ? [4, 4, 0, 0] : 0}
            // Surface-colored, so it reads as a 2px gap between segments
            // rather than as an outline. Without it the stack is one solid
            // column and the boundaries rely on hue alone — which is exactly
            // what fails for a colorblind reader.
            stroke={stacked ? "var(--bg-card)" : undefined}
            strokeWidth={stacked ? 2 : 0}
          />
        ))}
      </BarChart>
    );
  }
}

/** The exact numbers, for the reader who needs them and for the reader who
 * can't separate two of the hues. Not an optional extra: the light-mode
 * palette is only allowed to include its lighter slots because the values
 * stay reachable as text. */
function ChartTable({ spec, series }: { spec: ChartSpec; series: ChartSpec["series"] }) {
  return (
    <div className="max-h-56 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-[var(--bg-card)]">
          <tr className="text-[var(--text-dim)]">
            <th className="py-1 pr-2 font-semibold">Label</th>
            {series.map((item, index) => (
              <th key={item.name} className="py-1 pr-2 text-right font-semibold">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: SERIES_COLORS[index] }}
                  />
                  {item.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-[var(--text-muted)]">
          {spec.labels.map((label, rowIndex) => (
            <tr key={label} className="border-t border-[var(--border-color-subtle)]">
              <td className="py-1 pr-2">{formatLabel(label)}</td>
              {series.map((item) => (
                <td key={item.name} className="py-1 pr-2 text-right font-mono">
                  {formatValue(item.values[rowIndex] ?? 0, spec.value_format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
