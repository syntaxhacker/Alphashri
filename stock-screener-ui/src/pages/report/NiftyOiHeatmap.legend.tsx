import { formatNumberIN } from "@/utils/ui-helpers";
import { Button } from "@/ui";
import {
  alpha,
  HEATMAP_FLIP,
  HEATMAP_SPOT,
  LEVEL_MAX_PAIN,
  OI_CALL,
  OI_PUT,
  TERM_HEADER,
  TEXT_MUTED,
  WARNING,
} from "@/ui/palette";
import { For, Show } from "solid-js";
import { EmptyState, injectCollapseRule } from "@/components/common/states";
import { REPORT_FONT } from "./reportTokens";
import {
  EMPTY_COPY,
  OPACITY_LABELS,
  formatCoverageText,
  formatSpotRead,
} from "./NiftyOiHeatmap.format";
import type { readHeatmap } from "./niftyOiHeatmap";
import type { HeatmapCoverage, HeatmapEmptyKind } from "./niftyOiHeatmap";
import { sharedReportSpotSource, spotSnapshot } from "./ReportKpiHero";

type HeatmapRead = ReturnType<typeof readHeatmap>;

interface LegendItemDef {
  id: string;
  color: string;
  label: string;
  title: string;
  shape: "cell" | "line" | "dashed" | "dot";
}

const LEGEND: LegendItemDef[] = [
  {
    id: "ce",
    color: OI_CALL,
    label: "net call-led",
    title:
      "Blue cell — call-side ΔOI grew more than put-side ΔOI (net call-led). Cells are side-coded (CE blue / PE orange), never green/red: green/red would imply direction, which OI does not have. A blue cell does NOT mean calls were bought.",
    shape: "cell",
  },
  {
    id: "pe",
    color: OI_PUT,
    label: "net put-led",
    title:
      "Orange cell — put-side ΔOI grew more than call-side ΔOI (net put-led). Same caveat as the blue cell: it is a net read, not a single-leg build.",
    shape: "cell",
  },
  {
    id: "flat",
    color: TEXT_MUTED,
    label: "no ΔOI",
    title:
      "Gray cell — no OI change vs the previous bucket (or the first bucket, which is the baseline). A gray cell is NOT missing data.",
    shape: "cell",
  },
  {
    id: "spot",
    color: HEATMAP_SPOT,
    label: "spot",
    title: "Solid white line — NIFTY spot through the session",
    shape: "line",
  },
  {
    id: "maxpain",
    color: LEVEL_MAX_PAIN,
    label: "MP max pain",
    title: "Amber dashed — max-pain pin (MP) for each bucket; the strike where the most options expire worthless",
    shape: "dashed",
  },
  {
    id: "flip",
    color: HEATMAP_FLIP,
    label: "gamma flip",
    title: "Blue dashed — gamma-flip strike for each bucket",
    shape: "dashed",
  },
  {
    id: "mp-touch",
    color: LEVEL_MAX_PAIN,
    label: "max pain touch",
    title: "Amber dot — spot sits within 10 pts of max pain (MP) in that bucket",
    shape: "dot",
  },
];

function LegendItem(props: { item: LegendItemDef }) {
  const item = () => props.item;
  const swatchTestId = () => `nifty-heatmap-legend-${item().id}-swatch`;
  return (
    <span
      data-testid={`nifty-heatmap-legend-${item().id}`}
      title={item().title}
      class="inline-flex items-center gap-1 whitespace-nowrap"
    >
      {item().shape === "cell" ? (
        <span
          data-testid={swatchTestId()}
          aria-hidden="true"
          class="inline-block shrink-0 w-2 h-2 rounded-[1px]"
          style={{ "background-color": item().color }}
        />
      ) : item().shape === "dot" ? (
        <span
          data-testid={swatchTestId()}
          aria-hidden="true"
          class="inline-block shrink-0 w-2 h-2 rounded-full"
          style={{ "background-color": item().color }}
        />
      ) : item().shape === "line" ? (
        <span
          data-testid={swatchTestId()}
          aria-hidden="true"
          class="inline-block shrink-0 w-3 h-0.5"
          style={{ "background-color": item().color }}
        />
      ) : (
        <span
          data-testid={swatchTestId()}
          aria-hidden="true"
          class="inline-block shrink-0 w-3 h-0 border-t border-dashed"
          style={{ "border-color": item().color }}
        />
      )}
      <span>{item().label}</span>
    </span>
  );
}

export interface HeatmapLegendProps {
  windowLabel: string;
  windowTitle: string;
  metric: "oi" | "volume" | "premium";
  flipLabel: string | null;
}

export function HeatmapLegend(props: HeatmapLegendProps) {
  return (
    <div
      data-testid="nifty-heatmap-legend"
      aria-label="Heatmap legend"
      class="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 shrink-0 px-3 py-1 border-b border-fin-border text-ui-micro leading-[16px] font-mono text-fin-text-muted"
      style={{ "background-color": alpha(TERM_HEADER, 0.55) }}
    >
      <span
        data-testid="nifty-heatmap-legend-title"
        class="tracking-[0.08em] text-fin-text whitespace-nowrap shrink-0"
        title="OI change heatmap"
        style={{
          "font-size": `${REPORT_FONT.micro}px`,
          "font-weight": 600,
          "line-height": 1.2,
        }}
      >
        HEATMAP
      </span>
      <span
        data-testid="nifty-heatmap-window"
        class="shrink-0 px-1 rounded-[3px] text-ui-micro whitespace-nowrap"
        title={props.windowTitle}
        style={{ "background-color": alpha(TERM_HEADER, 0.9) }}
      >
        {props.windowLabel}
      </span>
      {/* The full key lives behind KEY, but the spot line is read against the
          plot continuously — name it in the header instead of hiding it. */}
      <span
        data-testid="nifty-heatmap-spot-key"
        class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
        title="Solid white line — NIFTY spot through the session"
      >
        <span
          data-testid="nifty-heatmap-spot-key-swatch"
          aria-hidden="true"
          class="inline-block w-3 h-0.5 shrink-0"
          style={{ "background-color": HEATMAP_SPOT }}
        />
        <span>SPOT</span>
      </span>
      <span
        data-testid="nifty-heatmap-ramp"
        class="flex-1 min-w-0 flex items-center gap-1"
        title="Cell colour: net call-led (blue) → no ΔOI (grey) → net put-led (amber). Opacity scales with the larger leg's change."
      >
        <span class="shrink-0 text-ui-micro whitespace-nowrap">CALL-LED</span>
        <span
          data-testid="nifty-heatmap-ramp-bar"
          class="flex-1 min-w-0 h-[6px] rounded-[3px]"
          style={{
            "background": `linear-gradient(90deg, ${OI_CALL} 0%, ${alpha(TEXT_MUTED, 0.28)} 50%, ${OI_PUT} 100%)`,
          }}
        />
        <span class="shrink-0 text-ui-micro whitespace-nowrap">PUT-LED</span>
      </span>
      <details data-testid="nifty-heatmap-key" class="shrink-0">
        <summary class="text-ui-micro cursor-pointer whitespace-nowrap" title="Full heatmap key">
          KEY
        </summary>
        <div class="flex flex-wrap gap-x-2 gap-y-1 pt-1 max-w-[400px]">
          <For each={LEGEND}>{(item) => <LegendItem item={item} />}</For>
          <Show when={props.flipLabel}>
            {(label) => (
              <LegendItem
                item={{
                  id: "flow-flip",
                  color: WARNING,
                  label: "flow flip",
                  title: `Amber dashed vertical — persisted last 5m CE/PE flow sign flip (${label()})`,
                  shape: "dashed",
                }}
              />
            )}
          </Show>
          <LegendItem
            item={{
              id: "opacity",
              color: TEXT_MUTED,
              label: OPACITY_LABELS[props.metric].label,
              title: OPACITY_LABELS[props.metric].title,
              shape: "cell",
            }}
          />
        </div>
      </details>
    </div>
  );
}

export interface HeatmapReadoutProps {
  read: HeatmapRead;
  readText: string;
  readFallback: string;
  /** As-of label for the tape spot when no shared report snapshot is present. */
  asOf?: string | null;
  /** Payload name for that fallback spot. */
  source?: string;
}

export function HeatmapReadout(props: HeatmapReadoutProps) {
  // The tape carries its own spot; use it only outside a report frame. Inside
  // the page, the shared report field is the single source for all readouts.
  const spotView = () =>
    spotSnapshot(
      sharedReportSpotSource() ?? {
        value: props.read.spot,
        asOf: props.asOf ?? null,
        origin: props.source ?? "Tape snapshot",
      },
      { digits: 0 },
    );
  return (
    <div
      data-testid="nifty-heatmap-read"
      title={props.readText || props.readFallback}
      class="px-3 py-1 shrink-0 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-micro leading-[1.3] font-mono text-fin-text whitespace-normal break-words"
    >
      <span
        data-testid="nifty-heatmap-read-label"
        class="shrink-0 text-ui-micro tracking-[0.08em] text-fin-text-muted"
      >
        READ
      </span>
      <Show
        when={formatSpotRead(props.read)}
        fallback={
          <span class="text-ui-micro text-fin-text-muted whitespace-nowrap">AWAITING CHAIN</span>
        }
      >
        {(s) => (
          <span
            data-testid="nifty-heatmap-read-spot"
            data-spot-source={spotView().source}
            data-spot-as-of={spotView().asOf ?? undefined}
            class="shrink-0 text-fin-text whitespace-nowrap"
            title={spotView().title}
            style={{
              "font-size": `${REPORT_FONT.body}px`,
              "font-weight": 600,
              "line-height": 1.2,
            }}
          >
            <span class="text-ui-micro text-fin-text-muted">SPOT</span> {spotView().display} <span class="text-ui-micro text-fin-text-muted">{s().relation}</span> <span class="text-ui-micro text-fin-text-muted">MP</span> {s().maxPain}
          </span>
        )}
      </Show>
      {/* One flex item for both walls: the old independent items let PE wrap
          alone under the spot read, so the label lost its CE sibling. A shared
          wrapper moves the pair together and keeps each label glued to its
          value at every width. */}
      <Show when={props.read.ceStrike !== null || props.read.peStrike !== null}>
        <span
          data-testid="nifty-heatmap-read-walls"
          class="inline-flex shrink-0 items-center gap-x-3 whitespace-nowrap"
        >
          <Show when={props.read.ceStrike !== null}>
            <span
              data-testid="nifty-heatmap-read-ce"
              class="shrink-0 whitespace-nowrap"
              title="Strongest call-side ΔOI build on this tape"
            >
              <span class="text-ui-micro text-fin-text-muted">CE</span> <span class="text-ui-body">{formatNumberIN(props.read.ceStrike as number)}</span>
            </span>
          </Show>
          <Show when={props.read.peStrike !== null}>
            <span
              data-testid="nifty-heatmap-read-pe"
              class="shrink-0 whitespace-nowrap"
              title="Strongest put-side ΔOI build on this tape"
            >
              <span class="text-ui-micro text-fin-text-muted">PE</span> <span class="text-ui-body">{formatNumberIN(props.read.peStrike as number)}</span>
            </span>
          </Show>
        </span>
      </Show>
      <span class="sr-only">{props.readText || props.readFallback}</span>
    </div>
  );
}

export interface HeatmapEmptyProps {
  kind: HeatmapEmptyKind;
  coverage: HeatmapCoverage;
  canRetry: boolean;
  retryLabel?: string;
  onRetry?: () => void;
}

export function HeatmapEmpty(props: HeatmapEmptyProps) {
  return (
    <>
      {/*
       * The side column's panel is `flex-auto` (ReportWorkspace), so an
       * empty heatmap reserved the entire chart row's height to show one
       * card. These rules let it shrink to what it renders and hand the
       * reclaimed rows back to the page. Injected into the head because a
       * `<style>` child would show up in the panel's own text content.
       */}
      {injectCollapseRule(
        "heatmap",
        `[data-testid="nifty-chart-side-heatmap"]:has([data-testid="nifty-heatmap-empty"]){flex:0 0 auto !important;}` +
          `[data-testid="nifty-heatmap-wrap"]:has([data-testid="nifty-heatmap-empty"]){flex:0 0 auto !important;}`,
      )}
      <div
        data-testid="nifty-heatmap-empty"
        class="w-full min-w-0 shrink-0 self-start border border-fin-border rounded-[2px] font-mono overflow-hidden"
        style={{ "background-color": TERM_HEADER }}
      >
        <div
          class="flex items-center gap-2 px-2 py-1 border-b border-fin-border text-ui-micro leading-[16px] text-fin-text-muted"
          style={{ "background-color": alpha(TERM_HEADER, 0.9) }}
        >
          <span
            data-testid="nifty-heatmap-legend-title"
            class="text-ui-micro tracking-[0.08em] text-fin-text whitespace-nowrap"
            title="OI change heatmap"
          >
            HEATMAP
          </span>
          <span data-testid="nifty-heatmap-empty-state" class="text-ui-micro whitespace-nowrap">
            {props.kind.replace("-", " ")}
          </span>
          <span class="ml-auto text-ui-micro whitespace-nowrap tabular-nums font-mono" title="What this session recorded">
            {formatCoverageText(props.coverage)}
          </span>
        </div>
        <EmptyState
          kind={props.kind}
          layout="row"
          className="px-2 py-1.5"
          title={EMPTY_COPY[props.kind].title}
          description={EMPTY_COPY[props.kind].description}
          descriptionTestId="nifty-heatmap-empty-text"
          hint={EMPTY_COPY[props.kind].hint}
          action={
            props.canRetry ? (
              <Button
                data-testid="nifty-heatmap-retry"
                size="xs"
                variant="outline"
                onClick={() => props.onRetry?.()}
              >
                {props.retryLabel ?? "Retry"}
              </Button>
            ) : undefined
          }
        />
      </div>
    </>
  );
}
