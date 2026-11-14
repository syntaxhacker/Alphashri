import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { hexToRgba } from "@/utils/color";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { CompactPanel } from "@/components/common/compact";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { formatLegChange, rowFlags } from "./optionChainMetrics";
import type { ChainWalls } from "./optionChainMetrics";
import {
  sentimentCode,
  sentimentLabel,
  sentimentNote,
  sentimentSign,
} from "./optionSentiment";
import { wallCode, wallSide } from "./niftyChartMath";
import { useNiftySpotTick } from "./niftyStreamSolid";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
} from "./reportTokens";
import { fetchLiveSensex } from "@/api/reportNifty";
import type { NiftyReplayMeta } from "@/api/reportNifty";
import type {
  NiftyReplay,
  NiftyReport,
  NiftySensex,
  NiftyStrike,
} from "@/types/niftyReport";

const REPLAY_STUB_REPORT = Object.freeze({}) as unknown as NiftyReport;

/** Flush panel header label. CompactPanel styles only *string* titles, so a JSX
 *  title (label + badges + control on one line) has to carry the same treatment
 *  itself — otherwise it renders as body copy inside the header strip. */
const PANEL_TITLE_STYLE: JSX.CSSProperties = {
  "font-family": palette.MONO,
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  "letter-spacing": REPORT_LETTER_SPACING.wide,
  "text-transform": "uppercase",
  "line-height": REPORT_LINE_HEIGHT.tight,
  color: palette.PRIMARY,
  "white-space": "nowrap",
};

export function ReportPanelTitle(props: { testId?: string; children: JSX.Element }) {
  return (
    <span data-testid={props.testId} style={PANEL_TITLE_STYLE}>
      {props.children}
    </span>
  );
}

const DECISION_CELL_CLASS =
  "flex flex-col justify-center flex-[1_1_0] gap-[1px] min-w-[92px] md:min-w-[96px] px-1 py-0.5 border-l first:border-l-0";
const DECISION_CELL_STYLE: JSX.CSSProperties = {
  "border-left": `1px solid ${palette.TERM_BORDER}`,
};

const DECISION_LABEL_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.xs - 1}px`,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "letter-spacing": REPORT_LETTER_SPACING.wide,
  "text-transform": "uppercase",
};

const DECISION_VALUE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.sm}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  "line-height": REPORT_LINE_HEIGHT.tight,
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const CONTEXT_CELL_CLASS =
  "flex flex-col justify-center flex-[1_1_0] gap-[1px] min-w-[64px] px-1 py-0.5 border-l";
const CONTEXT_CELL_STYLE: JSX.CSSProperties = {
  "border-left": `1px solid ${palette.TERM_BORDER}`,
};

const CONTEXT_LABEL_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.xs - 1}px`,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "letter-spacing": REPORT_LETTER_SPACING.normal,
  "text-transform": "uppercase",
};

const CONTEXT_VALUE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.sm}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
};

export function DecisionCell(props: {
  testId: string;
  label: string;
  value: JSX.Element;
  hint: string;
  accent?: string;
  title?: string;
  valueSize?: number;
}) {
  return (
    <Box
      data-testid={props.testId}
      title={props.title ? `${props.title} — ${props.hint}` : `${props.label}: ${props.hint}`}
      className={DECISION_CELL_CLASS}
      style={DECISION_CELL_STYLE}
    >
      <Text span size="xs" fw={700} c="dimmed" style={DECISION_LABEL_STYLE}>
        {props.label}
      </Text>
      <Text
        span
        fw={700}
        c={props.accent}
        style={{
          ...DECISION_VALUE_STYLE,
          ...(props.valueSize != null ? { "font-size": `${props.valueSize}px` } : {}),
        }}
        data-testid={`${props.testId}-value`}
      >
        {props.value}
      </Text>
    </Box>
  );
}

export function ContextCell(props: {
  testId: string;
  label: string;
  value: JSX.Element;
}) {
  return (
    <Box data-testid={props.testId} className={CONTEXT_CELL_CLASS} style={CONTEXT_CELL_STYLE}>
      <Text span size="xs" fw={700} c="dimmed" style={CONTEXT_LABEL_STYLE}>
        {props.label}
      </Text>
      <Text span fw={700} style={CONTEXT_VALUE_STYLE}>
        {props.value}
      </Text>
    </Box>
  );
}

export function DecisionChip(props: {
  testId: string;
  label: string;
  value: string;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <Button
      data-testid={props.testId}
      size="sm"
      variant="subtle"
      onClick={() => props.onClick()}
      title={`${props.label} — ${props.value}`}
      className="min-w-0 h-[20px] px-1 py-0 gap-[3px] rounded-[4px] whitespace-nowrap border-l"
      style={{ border: `1px solid ${palette.TERM_BORDER}` }}
    >
      <Text
        span
        size="xs"
        fw={700}
        c="dimmed"
        style={{ "font-size": "9px", "letter-spacing": "0.05em" }}
      >
        {props.label}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{
          "font-size": "9px",
          color: props.tone ?? palette.TEXT,
          "font-variant-numeric": "tabular-nums",
        }}
      >
        {props.value}
      </Text>
    </Button>
  );
}

export function formatSignedPoints(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${formatNumberIN(rounded)} pts`;
}

export function formatOiCr(oi: number | null | undefined): string {
  if (oi == null || !Number.isFinite(oi) || oi <= 0) return "—";
  if (oi >= 1e7) return `${(oi / 1e7).toFixed(2)} Cr`;
  if (oi >= 1e5) return `${(oi / 1e5).toFixed(1)} L`;
  return formatNumberIN(oi);
}

export function setupBannerHeadline(
  flipped: boolean,
  reason: string | null | undefined,
  score: number,
  max: number,
): string {
  return flipped
    ? `FLOW FLIP · ${reason ?? "5m vs 15m"} — setup paused`
    : `⏳ SETUP ARMING ${score}/${max}`;
}

export function buildOvernightLevels(report: NiftyReport): {
  resistance: { strike: number; pct: number }[];
  support: { strike: number; pct: number }[];
  painPull: { dir: string; pct: number };
  pcrVerdict: string;
} {
  const pct = (s: number) => (report.spot > 0 ? ((s - report.spot) / report.spot) * 100 : 0);
  const resistance = [...(report.walls?.calls ?? [])]
    .map((w) => w.strike)
    .filter((s) => s > report.spot)
    .sort((a, b) => a - b)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const support = [...(report.walls?.puts ?? [])]
    .map((w) => w.strike)
    .filter((s) => s < report.spot)
    .sort((a, b) => b - a)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const painPct = pct(report.maxPain);
  const painPull = {
    dir: painPct > 0.05 ? "up" : painPct < -0.05 ? "down" : "flat",
    pct: painPct,
  };
  const pcrOi = Number(report.pcrOi);
  const pcrVerdict = !Number.isFinite(pcrOi)
    ? "PCR-OI n/a — chain incomplete"
    : pcrOi < 0.7
      ? `Bearish (PCR-OI ${pcrOi.toFixed(2)} — call writers in control)`
      : pcrOi > 1.0
        ? `Bullish (PCR-OI ${pcrOi.toFixed(2)} — put writers in control)`
        : `Neutral (PCR-OI ${pcrOi.toFixed(2)})`;
  return { resistance, support, painPull, pcrVerdict };
}

export function sentimentBadge(sentiment: string, side: "ce" | "pe"): JSX.Element {
  const code = sentimentCode(sentiment);
  const label = sentimentLabel(sentiment);
  const sign = sentimentSign(sentiment, side);
  const tone = sign === 0 ? palette.TEXT_MUTED : sign > 0 ? palette.POSITIVE : palette.NEGATIVE;
  const short = sign === 0 ? label || "—" : code;
  const upperSide: "CE" | "PE" = side === "ce" ? "CE" : "PE";
  const title = code
    ? `${label} (${upperSide}) — ${sentimentNote(code, upperSide)}`
    : label || sentiment;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        gap: "4px",
        "max-width": "100%",
        overflow: "hidden",
        "padding-left": "4px",
        "padding-right": "4px",
        "padding-top": "1px",
        "padding-bottom": "1px",
        "border-radius": "3px",
        "white-space": "nowrap",
        "vertical-align": "middle",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "3px",
          height: "11px",
          "border-radius": "1px",
          "background-color": tone,
          "flex-shrink": 0,
        }}
      />
      <Text size="xs" fw={700} span truncate style={{ color: tone }}>
        {short}
      </Text>
    </span>
  );
}

export function wallTag(
  strike: number,
  spot: number,
  isCall: boolean,
  color: string,
): JSX.Element {
  const side = wallSide(strike, spot);
  const code = wallCode(isCall, side, false);
  const isPrimaryCall = isCall && side === "above";
  const isPrimaryPut = !isCall && side === "below";
  const testId = isPrimaryCall
    ? "nifty-wall-cw"
    : isPrimaryPut
      ? "nifty-wall-pw"
      : isCall
        ? "nifty-wall-cw-below"
        : "nifty-wall-pw-above";
  const title = isCall
    ? side === "above"
      ? "Call wall (top CE OI)"
      : "Call wall below spot (broken resistance)"
    : side === "below"
      ? "Put wall (top PE OI)"
      : "Put wall above spot (broken support)";
  return (
    <span
      data-testid={testId}
      title={title}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "3px",
        "flex-shrink": 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: "5px",
          height: "5px",
          "border-radius": "50%",
          "background-color": color,
          "flex-shrink": 0,
        }}
      />
      <Text size="xs" span fw={700} style={{ "font-size": "9px", color }}>
        {code}
      </Text>
    </span>
  );
}

export function oiChangeBarCell(
  value: number,
  max: number | undefined,
  legHue: string,
  barTestId: string,
): JSX.Element {
  const text = Number.isFinite(value) ? formatNumberIN(value) : "—";
  const denom = max != null && max > 0 ? max : 0;
  const pct =
    denom > 0 && Number.isFinite(value) ? Math.min(100, (Math.abs(value) / denom) * 100) : 0;
  const tone =
    value > 0 ? palette.POSITIVE : value < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
  return (
    <span
      title={`${text} ΔOI`}
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "flex-end",
        gap: "2px",
        overflow: "hidden",
        "font-family": palette.MONO,
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <Text size="xs" span fw={500} style={{ color: legHue }}>
        {text}
      </Text>
      <span
        aria-hidden
        style={{
          display: "block",
          width: "100%",
          height: "3px",
          "border-radius": "1px",
          "background-color": hexToRgba(legHue, 0.18),
          overflow: "hidden",
        }}
      >
        <span
          data-testid={barTestId}
          data-pct={Math.round(pct)}
          style={{
            display: "block",
            width: `${pct}%`,
            height: "100%",
            "border-radius": "1px",
            "background-color": tone,
          }}
        />
      </span>
    </span>
  );
}

export function legChangeCell(leg: NiftyStrike["ce"], legHue: string): JSX.Element {
  const change = formatLegChange(leg);
  const tone =
    change.points < 0
      ? palette.NEGATIVE
      : change.points > 0
        ? palette.POSITIVE
        : legHue;
  const sep = change.label.lastIndexOf(" (");
  const pointsText = sep >= 0 ? change.label.slice(0, sep) : change.label;
  const pctText = sep >= 0 ? change.label.slice(sep + 1) : "";
  return (
    <span
      title={change.label}
      style={{
        display: "block",
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "white-space": "nowrap",
        "font-family": palette.MONO,
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <Text size="xs" span fw={500} style={{ color: tone }}>
        {pointsText}
      </Text>
      <Show when={pctText}>
        <Text size="xs" span c="dimmed" style={{ "font-size": "10px" }}>
          {" "}
          {pctText}
        </Text>
      </Show>
    </span>
  );
}

export function gexRegimeText(regime: string): string {
  if (regime === "long") return "Dealers LONG gamma — moves dampened";
  if (regime === "short") return "Dealers SHORT gamma — moves amplified";
  return "Flat";
}

export function formatGexTotal(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} Cr/pt`;
}

export function formatGexLevel(strike: number, netGex: number): string {
  return `${formatNumberIN(strike)} (${netGex >= 0 ? "+" : ""}${netGex.toFixed(2)} Cr)`;
}

export function oiBurstLogHeight(count: number): number {
  return Math.min(22 + count * 20 + 18, 140);
}

export function replayFromMeta(meta: NiftyReplayMeta): NiftyReplay {
  return {
    date: meta.date,
    count: meta.frames.length,
    interval_sec: meta.interval_sec,
    gap_reasons: meta.gap_reasons,
    snapshots: meta.frames.map((f) => ({
      t: f.t,
      fetched_at: "",
      report: REPLAY_STUB_REPORT,
      sensex: null,
    })),
  };
}

const SENSEX_REQUEST_TIMEOUT_MS = 10_000;

export class SensexTimeoutError extends Error {
  constructor() {
    super("Sensex data request timed out");
    this.name = "SensexTimeoutError";
  }
}

export async function fetchSensexWithTimeout(
  controller: AbortController,
): Promise<NiftySensex> {
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SENSEX_REQUEST_TIMEOUT_MS);
  try {
    return await fetchLiveSensex(controller.signal);
  } catch (error) {
    if (timedOut) throw new SensexTimeoutError();
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function findAtmStrike(strikes: NiftyStrike[], spot: number): number | null {
  if (!strikes || strikes.length === 0) return null;
  if (!Number.isFinite(spot)) return null;
  let best = strikes[0].strike;
  let bestDist = Math.abs(best - spot);
  for (let i = 1; i < strikes.length; i++) {
    const s = strikes[i].strike;
    const d = Math.abs(s - spot);
    if (d < bestDist || (d === bestDist && s < best)) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

const OI_CE_CHG_W = 110;
const OI_CE_OI_W = 88;
const OI_SIG_W = 64;
const OI_STRIKE_W = 92;

export interface NiftyOiColumnOpts {
  maxCeOiChange?: number;
  maxPeOiChange?: number;
  spot?: number;
  walls?: ChainWalls;
  showLegChange?: boolean;
}

export function getNiftyOiColumns(
  atmStrike: number | null,
  opts?: NiftyOiColumnOpts,
): TableColumnDef<NiftyStrike>[] {
  const legChangeColumns: TableColumnDef<NiftyStrike>[] = [
    {
      id: "ceChg",
      header: <span title="points (LTP − prev close)">CE Chg</span>,
      accessorKey: "ce.priceChange",
      accessorFn: (row) => formatLegChange(row.ce).points,
      size: OI_CE_CHG_W,
      meta: { align: "right" },
      cell: (info) => legChangeCell(info.row.original.ce, palette.TERM_CE),
    },
  ];
  const coreColumns: TableColumnDef<NiftyStrike>[] = [
    {
      id: "ceOiChange",
      header: "CE OI Chg",
      accessorKey: "ce.oiChange",
      accessorFn: (row) => row.ce.oiChange,
      size: OI_CE_OI_W,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.row.original.ce.oiChange);
        return oiChangeBarCell(v, opts?.maxCeOiChange, palette.TERM_CE, "nifty-oi-bar-ce");
      },
    },
    {
      id: "ceSignal",
      header: "CE Signal",
      accessorKey: "ce.sentiment",
      accessorFn: (row) => row.ce.sentiment,
      size: OI_SIG_W,
      meta: { align: "center" },
      cell: (info) => sentimentBadge(String(info.row.original.ce.sentiment ?? ""), "ce"),
    },
    {
      id: "strike",
      header: "Strike",
      accessorKey: "strike",
      size: OI_STRIKE_W,
      meta: { align: "right" },
      cell: (info) => {
        const strike = Number(info.row.original.strike);
        const isAtm = atmStrike !== null && strike === atmStrike;
        const walls = opts?.walls ?? {};
        const flags =
          opts?.spot != null && Number.isFinite(opts.spot)
            ? rowFlags(info.row.original, opts.spot, walls)
            : null;
        const isCW = flags
          ? flags.callWall
          : (walls.calls ?? []).some((w) => w.strike === strike);
        const isPW = flags
          ? flags.putWall
          : (walls.puts ?? []).some((w) => w.strike === strike);
        const spot = opts?.spot ?? 0;
        return (
          <span
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "flex-end",
              gap: "4px",
              overflow: "hidden",
              "font-variant-numeric": "tabular-nums",
            }}
          >
            <Show when={isCW}>{wallTag(strike, spot, true, palette.TERM_CE)}</Show>
            <Show when={isPW}>{wallTag(strike, spot, false, palette.TERM_PE)}</Show>
            <Text
              size="xs"
              span
              fw={700}
              c={isAtm ? palette.TERM_FLIP : undefined}
              data-testid={isAtm ? "nifty-strike-atm-badge" : undefined}
              title={isAtm ? "ATM strike" : undefined}
            >
              {formatNumberIN(strike)}
            </Text>
          </span>
        );
      },
    },
    {
      id: "peSignal",
      header: "PE Signal",
      accessorKey: "pe.sentiment",
      accessorFn: (row) => row.pe.sentiment,
      size: OI_SIG_W,
      meta: { align: "center" },
      cell: (info) => sentimentBadge(String(info.row.original.pe.sentiment ?? ""), "pe"),
    },
    {
      id: "peOiChange",
      header: "PE OI Chg",
      accessorKey: "pe.oiChange",
      accessorFn: (row) => row.pe.oiChange,
      size: OI_CE_OI_W,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.row.original.pe.oiChange);
        return oiChangeBarCell(v, opts?.maxPeOiChange, palette.TERM_PE, "nifty-oi-bar-pe");
      },
    },
  ];
  if (opts?.showLegChange === false) return coreColumns;
  const peChg: TableColumnDef<NiftyStrike> = {
    id: "peChg",
    header: <span title="points (LTP − prev close)">PE Chg</span>,
    accessorKey: "pe.priceChange",
    accessorFn: (row) => formatLegChange(row.pe).points,
    size: OI_CE_CHG_W,
    meta: { align: "right" },
    cell: (info) => legChangeCell(info.row.original.pe, palette.TERM_PE),
  };
  return [...legChangeColumns, ...coreColumns, peChg];
}

const OI_CHAIN_PANEL_CLASS = "min-w-0 min-h-0";
const OI_CHAIN_PANEL_STYLE: JSX.CSSProperties = {
  "background-color": palette.TERM_BG,
  "border-color": palette.TERM_BORDER,
  contain: "size",
};

const OI_CHAIN_WRAP_CLASS = "flex min-w-0 min-h-0";
const OI_CHAIN_WRAP_STYLE: JSX.CSSProperties = { height: "100%" };

const OI_CHAIN_TABLE_STYLE: JSX.CSSProperties = { "min-width": 0 };

const OI_CHAIN_EXPAND_CLASS = "min-w-[22px] px-1 leading-none text-[12px]";

export function NiftySpotValue(props: { live: boolean; fallback: number }) {
  const tick = useNiftySpotTick();
  const value = () => (props.live ? tick()?.spot : undefined) ?? props.fallback;
  return <AnimatedValue value={value()} format={formatNumberIN} />;
}

export interface NiftyOiChainProps {
  strikes: NiftyStrike[];
  columns: TableColumnDef<NiftyStrike>[];
  getRowStyle: (row: NiftyStrike) => JSX.CSSProperties | undefined;
  getRowTestId: (row: NiftyStrike) => string | undefined;
  panelTestId: string;
  tableTestId: string;
  wrapTestId: string;
  wrapRef?: (el: HTMLDivElement | undefined) => void;
  onExpand?: () => void;
}

export function NiftyOiChain(props: NiftyOiChainProps) {
  return (
    <CompactPanel
      flush
      scrollable
      title="Option-chain OI (±750 ATM)"
      testId={props.panelTestId}
      action={
        <Show when={props.onExpand}>
          <Button
            data-testid="nifty-oi-expand"
            size="sm"
            variant="subtle"
            aria-label="Expand the option chain"
            title="Expand the option chain"
            onClick={() => props.onExpand?.()}
            className={OI_CHAIN_EXPAND_CLASS}
          >
            ⤢
          </Button>
        </Show>
      }
      className={OI_CHAIN_PANEL_CLASS}
      style={OI_CHAIN_PANEL_STYLE}
    >
      <Box
        ref={props.wrapRef}
        data-testid={props.wrapTestId}
        className={OI_CHAIN_WRAP_CLASS}
        style={OI_CHAIN_WRAP_STYLE}
      >
        <TanStackTable<NiftyStrike>
          data={props.strikes}
          columns={props.columns}
          dataTestId={props.tableTestId}
          emptyMessage="No strikes for this expiry"
          fillContainer
          style={OI_CHAIN_TABLE_STYLE}
          dense
          getRowStyle={props.getRowStyle}
          getRowTestId={props.getRowTestId}
        />
      </Box>
    </CompactPanel>
  );
}
