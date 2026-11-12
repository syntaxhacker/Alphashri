import { formatNumberIN } from "@/utils/ui-helpers";
import { createMemo, For, Show } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { LocalCompactPanel, LocalEmptyState } from "./reportBits";
import {
  buildWallMigration,
  type WallMigrationBucket,
  type WallMigrationRow,
} from "./niftyWallMigration";

/**
 * Step-line chart of the migrating pin — one step per clock bucket.
 *
 * Five series share the strike axis (Y) over session time (X): top call
 * wall (red), top put wall (green), max pain (blue dashed), ATM (grey
 * dotted) and spot (thin blue). Steps (not slopes) because walls jump
 * discretely between buckets. The latest value of each series is labelled
 * on the right edge. Inline SVG, ~180px tall, no chart dependency.
 */

interface NiftyWallMigrationProps {
  rows: WallMigrationRow[];
  bucketMin?: number;
}

interface PlottedSeries {
  key: string;
  name: string;
  color: string;
  dash?: string;
  width: number;
  testId: string;
  values: Array<number | null>;
}

const SVG_W = 560;
const SVG_H = 180;
const PAD_L = 44;
const PAD_R = 64;
const PAD_T = 8;
const PAD_B = 18;

/** Strike with Indian grouping (`23,500`), dash when absent. */
export function formatWallStrike(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return formatNumberIN(Math.round(v));
}

/** Step path (`H` then `V`) through finite points; gaps break the path. */
export function stepPath(
  xs: number[],
  ys: Array<number | null>,
): string {
  let d = "";
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y === null || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    const x = xs[i];
    if (!pen) {
      d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    } else {
      d += ` H ${x.toFixed(1)} V ${y.toFixed(1)}`;
    }
  }
  return d;
}

/** Series definitions (order = paint order; spot last = on top). */
export function migrationSeries(
  buckets: WallMigrationBucket[],
): PlottedSeries[] {
  const col = (b: WallMigrationBucket, k: "callWall" | "putWall" | "maxPain" | "atm" | "spot") =>
    buckets.map((x) => x[k]);
  return [
    {
      key: "call",
      name: "Call wall",
      color: palette.NEGATIVE,
      width: 1.5,
      testId: "nifty-wall-migration-call",
      values: col(buckets, "callWall"),
    },
    {
      key: "put",
      name: "Put wall",
      color: palette.POSITIVE,
      width: 1.5,
      testId: "nifty-wall-migration-put",
      values: col(buckets, "putWall"),
    },
    {
      key: "pain",
      name: "Max pain",
      color: palette.PRIMARY,
      dash: "5 3",
      width: 1.25,
      testId: "nifty-wall-migration-pain",
      values: col(buckets, "maxPain"),
    },
    {
      key: "atm",
      name: "ATM",
      color: palette.TEXT_MUTED,
      dash: "2 3",
      width: 1.25,
      testId: "nifty-wall-migration-atm",
      values: col(buckets, "atm"),
    },
    {
      key: "spot",
      name: "Spot",
      color: palette.TERM_SPOT,
      width: 1.25,
      testId: "nifty-wall-migration-spot",
      values: col(buckets, "spot"),
    },
  ];
}

export function NiftyWallMigration(props: NiftyWallMigrationProps) {
  const buckets = createMemo(() => buildWallMigration(props.rows, { bucketMin: props.bucketMin ?? 15 }));
  const series = createMemo(() => migrationSeries(buckets()));

  const finite = createMemo(() => {
    const all: number[] = [];
    for (const s of series()) {
      for (const v of s.values) {
        if (v !== null && Number.isFinite(v)) all.push(v);
      }
    }
    return all;
  });

  const geometry = createMemo(() => {
    const n = buckets().length;
    const innerW = SVG_W - PAD_L - PAD_R;
    const innerH = SVG_H - PAD_T - PAD_B;
    const f = finite();
    const loV = f.length > 0 ? Math.min(...f) : 0;
    const hiV = f.length > 0 ? Math.max(...f) : 1;
    const span = hiV - loV > 0 ? hiV - loV : 1;
    const pad = span * 0.08;
    const lo = loV - pad;
    const hi = hiV + pad;
    const xp = (i: number) => PAD_L + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yp = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * innerH;
    return { xs: buckets().map((_, i) => xp(i)), yOf: yp, lo, hi };
  });

  const latest = (s: PlottedSeries): number | null => {
    for (let i = s.values.length - 1; i >= 0; i--) {
      const v = s.values[i];
      if (v !== null && Number.isFinite(v)) return v;
    }
    return null;
  };

  const tickStep = () => Math.max(1, Math.ceil(buckets().length / 6));

  return (
    <Show
      when={buckets().length > 0}
      fallback={
        <LocalCompactPanel title="Wall migration" testId="nifty-wall-migration">
          <LocalEmptyState
            testId="nifty-wall-migration-empty"
            title="No tape yet"
            description="Wall migration builds once the option tape records."
          />
        </LocalCompactPanel>
      }
    >
      <LocalCompactPanel
        title="Wall migration — pin over time"
        testId="nifty-wall-migration"
      >
        <div class="flex flex-col gap-[4px] min-w-0">
          <div
            data-testid="nifty-wall-migration-legend"
            class="flex items-center gap-[10px] flex-wrap min-w-0"
          >
            <For each={series()}>{(s) => (
              <div class="inline-flex items-center gap-[4px]">
                <span
                  aria-hidden="true"
                  class="block w-[14px] h-0 shrink-0"
                  style={{ "border-top": `2px ${s.dash ? "dashed" : "solid"} ${s.color}` }}
                />
                <Text size="xs" span c="dimmed">
                  {s.name}
                </Text>
              </div>
            )}</For>
          </div>
          <svg
            data-testid="nifty-wall-migration-chart"
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            role="img"
            aria-label="Call wall, put wall, max pain, ATM and spot over time"
            class="w-full h-[180px] block min-w-0"
          >
            <text x={4} y={PAD_T + 8} font-size={9} fill={palette.TEXT_MUTED}>
              {formatWallStrike(geometry().hi)}
            </text>
            <text x={4} y={SVG_H - PAD_B} font-size={9} fill={palette.TEXT_MUTED}>
              {formatWallStrike(geometry().lo)}
            </text>
            <For each={buckets()}>{(b, i) => (
              i() % tickStep() === 0 ? (
                <text
                  x={geometry().xs[i()]}
                  y={SVG_H - 4}
                  font-size={9}
                  fill={palette.TEXT_MUTED}
                  text-anchor="middle"
                >
                  {b.label}
                </text>
              ) : null
            )}</For>
            <For each={series()}>{(s) => (
              <path
                data-testid={s.testId}
                d={stepPath(geometry().xs, s.values.map((v) => (v === null ? null : geometry().yOf(v))))}
                fill="none"
                stroke={s.color}
                stroke-width={s.width}
                stroke-dasharray={s.dash ?? undefined}
                stroke-linejoin="round"
              />
            )}</For>
            <For each={series()}>{(s) => {
              const v = latest(s);
              if (v === null) return null;
              return (
                <text
                  data-testid={`${s.testId}-label`}
                  x={SVG_W - 2}
                  y={Math.min(Math.max(geometry().yOf(v) + 3, PAD_T + 6), SVG_H - PAD_B)}
                  font-size={10}
                  font-weight={700}
                  fill={s.color}
                  text-anchor="end"
                >
                  {formatWallStrike(v)}
                </text>
              );
            }}</For>
          </svg>
          <Text size="xs" span c="dimmed" data-testid="nifty-wall-migration-caption">
            {buckets().length} buckets · Y = strike, X = time · steps join bucket closes
          </Text>
        </div>
      </LocalCompactPanel>
    </Show>
  );
}
