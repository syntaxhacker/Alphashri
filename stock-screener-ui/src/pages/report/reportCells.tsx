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
  REPORT_PAD,
  REPORT_ROW,
} from "./reportTokens";
import type { NiftyReport, NiftyStrike } from "@/types/niftyReport";

export { replayFromMeta } from "./niftyReplay";

const PANEL_TITLE_STYLE: JSX.CSSProperties = {
  "font-family": palette.MONO,
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.medium,
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
  "flex flex-col justify-center flex-[1_1_0] gap-[1px] min-w-[92px] md:min-w-[96px] px-1 py-0.5 border-l first:border-l-0 min-[1200px]:h-[40px]";
const DECISION_CELL_STYLE: JSX.CSSProperties = {
  "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
};

const DECISION_LABEL_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.medium,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "letter-spacing": REPORT_LETTER_SPACING.wide,
  "text-transform": "uppercase",
  "text-align": "left",
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const DECISION_VALUE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.semibold,
  "line-height": REPORT_LINE_HEIGHT.tight,
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  "text-align": "right",
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const CONTEXT_CELL_CLASS =
  "flex flex-col justify-center flex-[1_1_0] gap-[1px] min-w-[64px] px-1 py-0.5 border-l min-[1200px]:h-[40px]";
const CONTEXT_CELL_STYLE: JSX.CSSProperties = {
  "border-left": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
};

const CONTEXT_LABEL_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.medium,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "letter-spacing": REPORT_LETTER_SPACING.normal,
  "text-transform": "uppercase",
  "text-align": "left",
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const CONTEXT_VALUE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.semibold,
  "line-height": REPORT_LINE_HEIGHT.snug,
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  "text-align": "right",
};

export function DecisionCell(props: {
  testId: string;
  label: string;
  value: JSX.Element;
  hint: string;
  accent?: string;
  title?: string;
  valueSize?: number;
  minWidth?: number;
}) {
  // The dash lives on the value node, so the reason has to travel with it —
  // a cell-level tooltip alone leaves a bare "—" unexplained on hover.
  const help = () =>
    props.title ? `${props.title} — ${props.hint}` : `${props.label}: ${props.hint}`;
  return (
    <Box
      data-testid={props.testId}
      title={help()}
      className={DECISION_CELL_CLASS}
      style={{
        ...DECISION_CELL_STYLE,
        ...(props.minWidth != null ? { "min-width": `${props.minWidth}px` } : {}),
      }}
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
        title={help()}
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
  title?: string;
  valueSize?: number;
  minWidth?: number;
}) {
  return (
    <Box
      data-testid={props.testId}
      title={props.title}
      className={CONTEXT_CELL_CLASS}
      style={{
        ...CONTEXT_CELL_STYLE,
        ...(props.minWidth != null ? { "min-width": `${props.minWidth}px` } : {}),
      }}
    >
      <Text span size="xs" fw={700} c="dimmed" style={CONTEXT_LABEL_STYLE}>
        {props.label}
      </Text>
      <Text
        span
        fw={700}
        data-testid={`${props.testId}-value`}
        style={{
          ...CONTEXT_VALUE_STYLE,
          ...(props.valueSize != null ? { "font-size": `${props.valueSize}px` } : {}),
        }}
      >
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
  /** Full explanation, including why a value may be an em dash. */
  help?: string;
  ariaLabel?: string;
  /** Fill a stat-group cell slot instead of keeping an intrinsic width. */
  fill?: boolean;
  minWidth?: number;
}) {
  return (
    <Button
      data-testid={props.testId}
      size="sm"
      variant="subtle"
      onClick={() => props.onClick()}
      title={props.help ?? `${props.label} — ${props.value}`}
      aria-label={props.ariaLabel ?? `${props.label}: ${props.value}`}
      className="min-w-0 h-[20px] px-1 py-0 gap-[3px] rounded-[4px] whitespace-nowrap"
      style={{
        // The strip already draws the section border; a chip border inside it
        // is a card-inside-card. A tint keeps the chip readable as a control.
        "background-color": palette.alpha(palette.TERM_BORDER, 0.18),
        // Button's px-3 wins over the class-level px-1; the label and the
        // value both need that room back at the 13px body step.
        "padding-left": "4px",
        "padding-right": "4px",
        ...(props.minWidth != null ? { "min-width": `${props.minWidth}px` } : {}),
        ...(props.fill ? { flex: "1 1 0%", height: "100%" } : {}),
      }}
    >
      <Text
        span
        size="xs"
        fw={700}
        c="dimmed"
        style={{
          "font-size": `${REPORT_FONT.body}px`,
          "letter-spacing": "0.05em",
          "text-align": "left",
        }}
      >
        {props.label}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{
          flex: 1,
          "min-width": 0,
          "font-size": `${REPORT_FONT.body}px`,
          color: props.tone ?? palette.TEXT,
          "font-variant-numeric": "tabular-nums",
          "text-align": "right",
          overflow: "hidden",
          "text-overflow": "ellipsis",
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

export function sentimentBadge(
  sentiment: string,
  side: "ce" | "pe",
  emphasis = false,
): JSX.Element {
  const raw = String(sentiment ?? "").trim();
  const code = sentimentCode(raw);
  const label = sentimentLabel(raw);
  const sign = sentimentSign(raw, side);
  // Free-text payloads ("Bullish"/"Bearish") are outside the LB/SB/SC/LU
  // registry. Rendering them verbatim in a 72px chain cell cut "Bearish" to
  // "Beari…"; a direction word keeps the badge whole, with the reported text
  // preserved in the tooltip and the accessible name.
  const direction = code ? sign : /bull/i.test(raw) ? 1 : /bear/i.test(raw) ? -1 : 0;
  const short = code || (direction > 0 ? "BULL" : direction < 0 ? "BEAR" : "—");
  const upperSide: "CE" | "PE" = side === "ce" ? "CE" : "PE";
  const title = code
    ? `${label} (${upperSide}) — ${sentimentNote(code, upperSide)}`
    : label
      ? `${label} (${upperSide}) — reported sentiment`
      : `No sentiment reported (${upperSide})`;
  const tone =
    direction === 0 ? palette.TEXT_MUTED : direction > 0 ? palette.POSITIVE : palette.NEGATIVE;
  return (
    <span
      data-testid={`nifty-oi-signal-${side}`}
      role="img"
      aria-label={title}
      title={title}
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        gap: "3px",
        "max-width": "100%",
        overflow: "hidden",
        "padding-left": "3px",
        "padding-right": "3px",
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
      <Text
        size="xs"
        fw={emphasis ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.bold}
        span
        style={{ color: tone, opacity: emphasis ? 1 : 0.88 }}
      >
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
        gap: "2px",
        "flex-shrink": 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: "4px",
          height: "4px",
          "border-radius": "50%",
          "background-color": color,
          "flex-shrink": 0,
        }}
      />
      <Text
        size="xs"
        span
        fw={700}
        style={{ "font-size": `${REPORT_FONT.micro}px`, color }}
      >
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
      <Text
        size="xs"
        span
        fw={600}
        style={{ color: legHue, "font-size": `${OI_CHAIN_METRICS.valueSize}px` }}
      >
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
        "white-space": "nowrap",
        "font-family": palette.MONO,
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <Text
        size="xs"
        span
        fw={600}
        style={{ color: tone, "font-size": `${OI_CHAIN_METRICS.valueSize}px` }}
      >
        {pointsText}
      </Text>
      <Show when={pctText}>
        <Text size="xs" span c="dimmed" style={{ "font-size": `${REPORT_FONT.micro}px` }}>
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

/**
 * Chain rhythm. Column labels stay at the 12px floor while the numbers they
 * label read at the 13px body step; the old `dense` preset squeezed both into
 * 18px rows with 1px/6px insets, which cut wall tags and ΔOI values mid-word.
 */
export const OI_CHAIN_METRICS = {
  rowHeight: REPORT_ROW.walls, // 26 — deliberate row height, no 18px cram
  cellPadding: `${REPORT_PAD.sm}px ${REPORT_PAD.md}px`, // 4px 8px
  labelSize: REPORT_FONT.micro, // 12 — column labels
  valueSize: REPORT_FONT.body, // 13 — numbers and badges they describe
} as const;

// Full chain (390px): roomy columns behind the wrapper's horizontal scroll.
const OI_CE_CHG_W = 116;
const OI_CE_OI_W = 96;
const OI_SIG_W = 80;
const OI_STRIKE_W = 128;

/**
 * Desk chain (1600px): five core columns must fit the measured ~420px side
 * panel with no clipping. Widths are the smallest that still hold the widest
 * real value at the 12/13px scale — ΔOI "2.69 Cr", signal "BULL", STRIKE
 * "25,700" plus two wall tags — with the 4px/8px cell inset.
 */
const OI_DESK_OI_W = 76;
const OI_DESK_SIG_W = 60;
const OI_DESK_STRIKE_W = 112;
/** Measured width of the report's right-hand chain panel at 1600px. */
export const OI_CHAIN_PANEL_BUDGET = 420;
/** 76 + 60 + 112 + 60 + 76 — deliberately below the panel budget. */
export const OI_CHAIN_DESK_WIDTH =
  OI_DESK_OI_W * 2 + OI_DESK_SIG_W * 2 + OI_DESK_STRIKE_W;

/**
 * Two-tone column label: the side token is the header, the metric token is its
 * subheader. Kept in one compact label so the 6-character textContent (and the
 * existing header test) still holds while the eye gets a stable left anchor on
 * each side of STRIKE. The full description stays in the native tooltip.
 */
function chainHeader(side: string, metric: string, title: string): JSX.Element {
  return (
    <span title={title}>
      <span style={{ color: palette.TEXT, "font-weight": REPORT_FONT_WEIGHT.extrabold }}>{side}</span>
      <span style={{ color: palette.TEXT_MUTED, "font-weight": REPORT_FONT_WEIGHT.medium }}>
        {" "}
        {metric}
      </span>
    </span>
  );
}

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
  // The caller's `showLegChange: false` is the desk/core selection: fit the
  // ~420px side panel. The full seven-column chain stays roomy and scrolls.
  const compact = opts?.showLegChange === false;
  const oiW = compact ? OI_DESK_OI_W : OI_CE_OI_W;
  const sigW = compact ? OI_DESK_SIG_W : OI_SIG_W;
  const strikeW = compact ? OI_DESK_STRIKE_W : OI_STRIKE_W;
  // ATM and max-OI wall strikes are the rows worth scanning first. Carry the
  // predicate on the strike column so the table host can mark the whole row
  // without a second copy of the wall/ATM rules.
  const rowFocus = (row: NiftyStrike): boolean => {
    const strike = Number(row.strike);
    if (atmStrike !== null && strike === atmStrike) return true;
    const walls = opts?.walls ?? {};
    const flags =
      opts?.spot != null && Number.isFinite(opts.spot)
        ? rowFlags(row, opts.spot, walls)
        : null;
    return flags
      ? flags.callWall || flags.putWall
      : (walls.calls ?? []).some((w) => w.strike === strike) ||
          (walls.puts ?? []).some((w) => w.strike === strike);
  };
  const legChangeColumns: TableColumnDef<NiftyStrike>[] = [
    {
      id: "ceChg",
      header: chainHeader("CE", "Chg", "points (LTP − prev close)"),
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
      header: chainHeader("CE", "ΔOI", "CE OI Chg — change in call open interest since the previous snapshot"),
      accessorKey: "ce.oiChange",
      accessorFn: (row) => row.ce.oiChange,
      size: oiW,
      meta: { align: "right" },
      cell: (info) => {
        const v = Number(info.row.original.ce.oiChange);
        return oiChangeBarCell(v, opts?.maxCeOiChange, palette.TERM_CE, "nifty-oi-bar-ce");
      },
    },
    {
      id: "ceSignal",
      header: chainHeader("CE", "SIG", "CE Signal — call-side position build/unwind: bullish, bearish or neutral"),
      accessorKey: "ce.sentiment",
      accessorFn: (row) => row.ce.sentiment,
      size: sigW,
      meta: { align: "center" },
      cell: (info) =>
        sentimentBadge(
          String(info.row.original.ce.sentiment ?? ""),
          "ce",
          rowFocus(info.row.original),
        ),
    },
    {
      id: "strike",
      header: <span title="Strike price (₹)">STRIKE</span>,
      accessorKey: "strike",
      size: strikeW,
      meta: { align: "right" },
      chainRowFocus: rowFocus,
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
        const focused = isAtm || isCW || isPW;
        const spot = opts?.spot ?? 0;
        return (
          <span
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "flex-end",
              gap: "3px",
              overflow: "hidden",
              "font-variant-numeric": "tabular-nums",
            }}
          >
            <Show when={isCW}>{wallTag(strike, spot, true, palette.TERM_CE)}</Show>
            <Show when={isPW}>{wallTag(strike, spot, false, palette.TERM_PE)}</Show>
            <Text
              size="xs"
              span
              fw={focused ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.bold}
              c={isAtm ? palette.TERM_FLIP : undefined}
              data-testid={isAtm ? "nifty-strike-atm-badge" : undefined}
              title={isAtm ? "ATM strike" : undefined}
              data-chain-focus-text={focused ? "1" : undefined}
              style={{
                "font-size": `${OI_CHAIN_METRICS.valueSize}px`,
                ...(focused ? { color: palette.TERM_FLIP } : {}),
              }}
            >
              {formatNumberIN(strike)}
            </Text>
          </span>
        );
      },
    },
    {
      id: "peSignal",
      header: chainHeader("PE", "SIG", "PE Signal — put-side position build/unwind: bullish, bearish or neutral"),
      accessorKey: "pe.sentiment",
      accessorFn: (row) => row.pe.sentiment,
      size: sigW,
      meta: { align: "center" },
      cell: (info) =>
        sentimentBadge(
          String(info.row.original.pe.sentiment ?? ""),
          "pe",
          rowFocus(info.row.original),
        ),
    },
    {
      id: "peOiChange",
      header: chainHeader("PE", "ΔOI", "PE OI Chg — change in put open interest since the previous snapshot"),
      accessorKey: "pe.oiChange",
      accessorFn: (row) => row.pe.oiChange,
      size: oiW,
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
    header: chainHeader("PE", "Chg", "points (LTP − prev close)"),
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
  // `contain: size` made the panel's intrinsic height zero, so the parent's
  // flex:1 stretched a five-row chain across the whole chart row. Layout/paint
  // isolation without size containment lets the panel hug its real rows.
  contain: "layout paint",
  flex: "0 0 auto",
  "align-self": "flex-start",
};

/** Real ATM/wall row emphasis — no placeholder tint on the other rows. */
const OI_CHAIN_FOCUS_STYLE: JSX.CSSProperties = {
  "background-color": hexToRgba(palette.TERM_FLIP, 0.16),
  "box-shadow": `inset 3px 0 0 ${palette.TERM_FLIP}`,
};

/**
 * TanStackTable paints padding/height/size inline on every cell. An `!important`
 * rule on the cell itself is the only way to keep the chain's own rhythm
 * without forking the shared table (a custom property on an ancestor loses to
 * the table's inline declaration). Font sizes reference the shared `--text-ui-*`
 * tokens, never a private px literal. `overflow-x: auto` is the real scroll cue
 * at 390: the seven-column chain keeps its full width instead of tearing values
 * mid-word to fit the phone.
 */
const OI_CHAIN_WRAP_CLASS = [
  "flex min-w-0 min-h-0 overflow-x-auto",
  "[&_td]:[padding:4px_8px]!",
  "[&_td]:[height:26px]!",
  "[&_td]:[font-size:var(--text-ui-body)]!",
  "[&_th]:[padding:4px_8px]!",
  "[&_th]:[height:28px]!",
  "[&_th]:[font-size:var(--text-ui-micro)]!",
  "[&_thead_th]:[border-bottom:2px_solid_var(--color-fin-border)]!",
  "[&_td]:[text-overflow:clip]!",
].join(" ");
const OI_CHAIN_WRAP_STYLE: JSX.CSSProperties = {
  height: "auto",
  "overflow-x": "auto",
};

const OI_CHAIN_TABLE_STYLE: JSX.CSSProperties = { "min-width": 0 };

const OI_CHAIN_EXPAND_CLASS = "min-w-[22px] px-1 leading-none text-ui-micro";

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
  const focusOf = (row: NiftyStrike): boolean => {
    const strikeColumn = props.columns.find((c) => c.id === "strike") as
      | (TableColumnDef<NiftyStrike> & { chainRowFocus?: (row: NiftyStrike) => boolean })
      | undefined;
    return strikeColumn?.chainRowFocus?.(row) ?? false;
  };
  const rowStyle = (row: NiftyStrike): JSX.CSSProperties => ({
    ...props.getRowStyle(row),
    ...(focusOf(row) ? OI_CHAIN_FOCUS_STYLE : {}),
  });
  const rowAttributes = (row: NiftyStrike) => ({
    "data-chain-focus": focusOf(row) ? "1" : undefined,
  });
  return (
    <CompactPanel
      flush
      scrollable
      title={<ReportPanelTitle>Option-chain OI (±750 ATM)</ReportPanelTitle>}
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
        data-chain-row-height={OI_CHAIN_METRICS.rowHeight}
        data-chain-value-size={OI_CHAIN_METRICS.valueSize}
        data-chain-variant={props.columns.length <= 5 ? "compact" : "full"}
        data-chain-scroll="1"
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
          getRowStyle={rowStyle}
          getRowAttributes={rowAttributes}
          getRowTestId={props.getRowTestId}
        />
      </Box>
    </CompactPanel>
  );
}
