import { For, Show, type JSX } from "solid-js";
import * as palette from "@/ui/palette";
import { Box, Text } from "@/ui";
import { formatNumberIN, formatTimeOnly } from "@/utils/ui-helpers";
import type { NiftyReport } from "@/types/niftyReport";
import { formatReportNum } from "./reportFormat";
import { gexFlipAtSpot } from "./niftyGex";
import { resolveRegimeLabel } from "./NiftyVerdictStrip";
import { REPORT_FONT, REPORT_GUTTER, REPORT_KPI_HERO_HEIGHT, REPORT_RADIUS } from "./reportTokens";
import { useNiftyReport } from "./ReportContext";

export type KpiTokenKey = "flip" | "walls";

export interface ReportKpiHeroProps {
  report: NiftyReport | null;
  /** The verdict chip + action levels + single percentage, rendered once. */
  decisionSlot?: JSX.Element;
  /** Compact ALL STATS affordance; it owns its own positioned detail surface. */
  statsToggle?: JSX.Element;
  /** @deprecated Detail is rendered by `statsToggle`, never in the band's flow. */
  details?: JSX.Element;
  /** Marks the band as the anchor of an open popover; never changes its height. */
  expand?: boolean;
  onToken?: (key: KpiTokenKey) => void;
}

const DASH = "—";

/** One payload field owns every nearby spot readout: `report.spot` at the
 * instant named by `report.snapshotAt`. Walls and tape rows may carry their
 * own spot; they are snapshots of other instants and must not be substituted. */
export interface SpotSource {
  value: number | null | undefined;
  asOf: string | null;
  origin: string;
}

/**
 * The Index Report prints spot at two precisions: the KPI rounds to whole
 * points, the walls card and the chart keep paise. One descriptor owns both
 * renderings, the source name and the as-of instant, so a difference between
 * payloads is named instead of looking like a feed disagreement.
 */
export interface SpotSnapshotView {
  /** Value at the caller's precision — never recomputed in a component. */
  display: string;
  /** Always two decimals, used by every title. */
  exact: string;
  asOf: string | null;
  /** Payload that owns the value, exposed on each surface for inspection. */
  source: string;
  title: string;
}

export function reportSpotSource(report: NiftyReport | null | undefined): SpotSource {
  return {
    value: report?.spot,
    asOf: report?.snapshotAt ? formatTimeOnly(report.snapshotAt) : report?.date || null,
    origin: report?.mode === "eod" ? "EOD snapshot" : "Snapshot",
  };
}

/** Outside <ReportProvider> this is null: standalone widgets and tests keep
 * their own payload label rather than throwing on the context lookup. */
export function sharedReportSpotSource(): SpotSource | null {
  try {
    const report = useNiftyReport().data.report();
    return report ? reportSpotSource(report) : null;
  } catch {
    return null;
  }
}

function isSpotSource(value: SpotSource | number | null | undefined): value is SpotSource {
  return typeof value === "object" && value !== null && "value" in value;
}

export function spotSnapshot(
  source: SpotSource | number | null | undefined,
  options: { digits?: number; asOf?: string | null; origin?: string } = {},
): SpotSnapshotView {
  const snapshot: SpotSource = isSpotSource(source)
    ? source
    : {
        value: source,
        asOf: options.asOf ?? null,
        origin: options.origin ?? "Snapshot",
      };
  const digits = options.digits ?? 0;
  const display = formatReportNum(snapshot.value, {
    digits,
    minDigits: digits,
    round: digits === 0,
  });
  const exact = formatReportNum(snapshot.value, { digits: 2, minDigits: 2 });
  const asOf = snapshot.asOf?.trim() || null;
  const origin = snapshot.origin || "Snapshot";
  const precision = digits === 2 ? "2 dp" : "whole points";
  const title = `${asOf ? `${origin} ${asOf}` : origin} · spot ${exact} (shown in ${precision}) · KPI rounds to whole points; walls and chart print 2 dp`;
  return { display, exact, asOf, source: origin, title };
}

interface KpiToken {
  key: string;
  label: string;
  value: () => string;
  ink: () => string;
  open?: KpiTokenKey;
  title: string | (() => string);
  /** Provenance of the value, mirrored as data-* so surfaces can be compared. */
  source?: () => string;
  asOf?: () => string | null;
  /** SPOT is the only KPI that can hold a row beside the call on a phone. */
  narrowHide?: boolean;
}

/** Caption sits above a short mono value: two tight lines inside 32px. */
const CAPTION_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": 800,
  "letter-spacing": "0.08em",
  color: palette.TEXT_MUTED,
  "text-transform": "uppercase",
  "line-height": 1,
  "white-space": "nowrap",
};

const VALUE_STYLE: JSX.CSSProperties = {
  "font-family": palette.MONO,
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": 700,
  "font-variant-numeric": "tabular-nums",
  "line-height": 1.1,
  "white-space": "nowrap",
};

const DIVIDER_STYLE: JSX.CSSProperties = {
  width: "1px",
  height: "18px",
  "align-self": "center",
  "background-color": palette.TERM_BORDER,
  "margin-left": `${REPORT_GUTTER.inline}px`,
  "margin-right": `${REPORT_GUTTER.inline}px`,
};

function KpiCell(props: { token: KpiToken; onToken?: (key: KpiTokenKey) => void }): JSX.Element {
  const narrowClass = () => (props.token.narrowHide ? "max-[600px]:hidden" : "");
  const content = (
    <>
      <Text span style={CAPTION_STYLE}>{props.token.label}</Text>{" "}
      <Text span style={VALUE_STYLE}>{props.token.value()}</Text>
    </>
  );
  // axe's label-content-name-mismatch compares the DOM's visible text with the
  // accessible name: the space must exist in both, and stay in sync when a live
  // report changes the value. A whitespace-only child of a flex column creates
  // no flex item, so this adds no height or width to the 32px band.
  const label = () => `${props.token.label} ${props.token.value()}`;
  const ink = { color: props.token.ink() };
  const title = () =>
    typeof props.token.title === "function" ? props.token.title() : props.token.title;

  return (
    <Show
      when={props.token.open}
      fallback={
        <span
          data-testid={`nifty-kpi-${props.token.key}`}
          data-spot-source={props.token.source?.()}
          data-spot-as-of={props.token.asOf?.() ?? undefined}
          title={title()}
          aria-label={label()}
          className={`inline-flex flex-col items-start justify-center shrink-0 min-w-0 rounded-[2px] leading-none ${narrowClass()}`}
          style={ink}
        >
          {content}
        </span>
      }
    >
      <button
        type="button"
        data-testid={`nifty-kpi-${props.token.key}`}
        data-spot-source={props.token.source?.()}
        data-spot-as-of={props.token.asOf?.() ?? undefined}
        title={title()}
        aria-label={label()}
        className={`inline-flex flex-col items-start justify-center shrink-0 min-w-0 rounded-[2px] leading-none ${narrowClass()}`}
        style={ink}
        onClick={() => props.token.open && props.onToken?.(props.token.open)}
      >
        {content}
      </button>
    </Show>
  );
}

/**
 * One fixed-height decision band. The call owns the left flex cell and the four
 * captioned KPI cells own the right one; an inset hairline is its only outline.
 * Detail opened from this band is a positioned popover owned by the toggle, so
 * neither this band nor the chart behind it can change height when it opens.
 */
export function ReportKpiHero(props: ReportKpiHeroProps): JSX.Element {
  const spotView = () =>
    spotSnapshot(sharedReportSpotSource() ?? reportSpotSource(props.report), { digits: 0 });
  const spot = (): string => spotView().display;

  const regime = (): string => {
    const block = props.report?.regime;
    return block?.verdict ? resolveRegimeLabel(block.verdict, block) : DASH;
  };

  const gammaFlip = (): string => {
    const current = props.report;
    if (!current) return DASH;
    const flip = gexFlipAtSpot(current.gex, current.spot);
    return flip != null && Number.isFinite(flip) ? formatNumberIN(Math.round(flip)) : DASH;
  };

  const walls = (): string => {
    const current = props.report;
    if (!current) return DASH;
    const board = current.wallsNear ?? current.walls;
    const call = board?.calls?.[0]?.strike;
    const put = board?.puts?.[0]?.strike;
    if (call == null && put == null) return DASH;
    const fmt = (value: number | null | undefined) =>
      value != null && Number.isFinite(value) ? formatNumberIN(Math.round(value)) : DASH;
    return `${fmt(call)}/${fmt(put)}`;
  };

  const tokens: KpiToken[] = [
    {
      key: "spot",
      label: "SPOT",
      value: spot,
      ink: () => palette.TEXT,
      title: () => spotView().title,
      source: () => spotView().source,
      asOf: () => spotView().asOf,
    },
    {
      key: "regime",
      label: "REGIME",
      value: regime,
      ink: () => palette.PRIMARY,
      narrowHide: true,
      title: "Range-vs-trend verdict carried by the report.",
    },
    {
      key: "gamma-flip",
      label: "GAMMA FLIP",
      value: gammaFlip,
      ink: () => palette.TERM_FLIP,
      open: "flip",
      narrowHide: true,
      title: "Dealer gamma flip strike. Opens the gamma profile.",
    },
    {
      key: "walls",
      label: "WALLS",
      value: walls,
      ink: () => palette.TERM_CE,
      open: "walls",
      narrowHide: true,
      title: "Heaviest call / put OI strikes. Opens the walls panel.",
    },
  ];

  return (
    <Box
      data-testid="nifty-kpi-hero"
      data-report-band="decision-band"
      data-expanded={props.expand ? "true" : "false"}
      className="flex flex-nowrap items-center w-full min-w-0 shrink-0"
      style={{
        height: `${REPORT_KPI_HERO_HEIGHT}px`,
        "min-height": `${REPORT_KPI_HERO_HEIGHT}px`,
        padding: `0 ${REPORT_GUTTER.inline}px`,
        gap: `${REPORT_GUTTER.inline}px`,
        "background-color": palette.SURFACE_ALT,
        // An inset hairline reads as the band's single outline without adding a
        // second bordered card inside the already-bordered stat strip.
        "box-shadow": `inset 0 0 0 1px ${palette.BORDER}`,
        "border-radius": `${REPORT_RADIUS.xs}px`,
        // The popover is fixed and must not be clipped by this surface.
        overflow: "visible",
      }}
    >
      <Box className="flex flex-nowrap items-center gap-1 min-w-0 flex-1">
        <Show when={props.decisionSlot}>{props.decisionSlot}</Show>
        <Show when={props.statsToggle}>{props.statsToggle}</Show>
      </Box>
      <Box
        data-testid="nifty-kpi-tokens"
        className="flex flex-nowrap items-center justify-start shrink-0"
      >
        <For each={tokens}>
          {(token, index) => (
            <>
              <Show when={index() > 0}>
                <span
                  data-kpi-divider
                  aria-hidden="true"
                  className={token.narrowHide ? "max-[600px]:hidden" : ""}
                  style={DIVIDER_STYLE}
                />
              </Show>
              <KpiCell token={token} onToken={props.onToken} />
            </>
          )}
        </For>
      </Box>
    </Box>
  );
}
