import { For, Show } from "solid-js";
import { Box, Text } from "@/ui";
import { AGRI_ACCENT, AGRI_CONTEXT, AGRI_DOWN, AGRI_UP } from "@/ui/palette";
import { formatAgriPrice, formatChangePct } from "@/config/agri";
import type { AgriSparkRow } from "./agriRedesignData";

export interface AgriSparkGridProps {
  rows: readonly AgriSparkRow[];
  selected: string;
  onSelect: (key: string) => void;
  className?: string;
  testId?: string;
  "data-testid"?: string;
}

const WIDTH = 72;
const HEIGHT = 22;

function sparkPoints(values: readonly number[]): string {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return "";
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  return finite
    .map((value, index) => {
      const x = finite.length === 1 ? WIDTH / 2 : (index / (finite.length - 1)) * WIDTH;
      const y = span === 0 ? HEIGHT / 2 : HEIGHT - 2 - ((value - min) / span) * (HEIGHT - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function SparkCell(props: { row: AgriSparkRow; selected: boolean; onSelect: (key: string) => void }) {
  const points = () => sparkPoints(props.row.points);
  const colour = () => (props.selected ? AGRI_ACCENT : AGRI_CONTEXT);
  const changeColour = () => {
    const value = props.row.change;
    if (value == null || value === 0) return AGRI_CONTEXT;
    return value > 0 ? AGRI_UP : AGRI_DOWN;
  };
  const title = () =>
    `${props.row.label} · ${formatAgriPrice(props.row.modal)} · 1M ${formatChangePct(props.row.change)}` +
    (points() ? " · path from this request" : " · no price path in this request");

  return (
    <Box
      component="button"
      type="button"
      data-testid={`agri-spark-${props.row.key}`}
      data-selected={props.selected ? "true" : "false"}
      data-key={props.row.key}
      aria-pressed={props.selected ? "true" : "false"}
      aria-label={`Select ${props.row.label}`}
      title={title()}
      onClick={() => props.onSelect(props.row.key)}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(props.row.key);
        }
      }}
      className={[
        "flex min-w-0 flex-col gap-1 rounded-[4px] border p-2 text-left",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-text",
        "hover:bg-fin-surface-alt",
        props.selected ? "border-fin-primary bg-fin-surface-alt" : "border-fin-border bg-fin-surface",
      ].join(" ")}
    >
      <Text size="xs" fw={700} truncate className="min-w-0 w-full" title={props.row.label}>
        {props.row.label}
      </Text>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        class="h-[22px] w-full"
        role="img"
        aria-hidden="true"
      >
        <Show
          when={points() !== ""}
          fallback={
            <line
              x1="0"
              y1={HEIGHT / 2}
              x2={WIDTH}
              y2={HEIGHT / 2}
              stroke={AGRI_CONTEXT}
              stroke-opacity="0.4"
              stroke-width="1"
              stroke-dasharray="3 3"
            />
          }
        >
          <polyline
            points={points()}
            fill="none"
            stroke={colour()}
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />
        </Show>
      </svg>
      <Box className="flex min-w-0 w-full items-baseline justify-between gap-1">
        <Text className="font-mono tabular-nums text-ui-micro" title="Latest modal ₹/quintal">
          {formatAgriPrice(props.row.modal)}
        </Text>
        <Text
          className="font-mono tabular-nums text-ui-micro shrink-0"
          style={{ color: changeColour() }}
          title="Change vs. the prior month (1M)"
        >
          {formatChangePct(props.row.change)}
        </Text>
      </Box>
    </Box>
  );
}

/** Direct-labelled commodity universe; each cell is a native button so
 *  Enter/Space select the hero exactly like a pointer click. */
export function AgriSparkGrid(props: AgriSparkGridProps) {
  const testId = () => props.testId ?? props["data-testid"] ?? "agri-spark-grid";
  return (
    <Box
      data-testid={testId()}
      className={["grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", props.className]
        .filter(Boolean)
        .join(" ")}
    >
      <For each={props.rows}>
        {(row) => (
          <SparkCell
            row={row}
            selected={props.selected === row.key}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </Box>
  );
}
