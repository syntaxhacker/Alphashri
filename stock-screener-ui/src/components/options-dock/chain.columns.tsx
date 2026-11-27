import { Show } from "solid-js";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { IconChartLine } from "@/components/common/Icons";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import type { ChainLevel, ChainLeg, ChainRow, OptionChainLevels } from "@/api/optionsDock";
import { formatNumber } from "@/utils/ui-helpers";

/**
 * Chain column definitions.
 *
 * Column order is the wireframe contract: CE side reads outward-in as
 * `OI IV Δ LTP`, the strike sits in the middle, and the PE side mirrors it as
 * `LTP Δ IV OI`. Numbers are right-aligned, the strike is centred — and the
 * wrapper's own `justify` matches `meta.align`, which is where the centring
 * bug comes from when the two disagree.
 */

const DASH = "—";

function fmtGreek(value: number | null, digits: number): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value.toFixed(digits);
}

function fmtIv(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return DASH;
  return value.toFixed(1);
}

const CELL = "block w-full font-mono tabular-nums text-ui-micro leading-[14px]";
const STRIKE_CELL =
  "relative flex w-full items-center justify-center gap-2 text-center font-mono tabular-nums text-ui-micro leading-[14px]";

/** A missing numeric cell carries a state label, not just a punctuation mark. */
function NumericCell(props: { value: string; className?: string }) {
  return (
    <span
      className={`${CELL}${props.className ? ` ${props.className}` : ""}`}
      aria-label={props.value === DASH ? "unpriced" : undefined}
    >
      {props.value}
    </span>
  );
}

/** Opens the per-contract chart. Native `<button>` gives Enter/Space parity. */
function ChartButton(props: {
  leg: ChainLeg;
  optionType: "CE" | "PE";
  strike: number;
  onChart: (strike: number, type: "CE" | "PE", leg: ChainLeg) => void;
}) {
  const label = () => `View ${props.strike} ${props.optionType} premium chart`;
  return (
    <Box
      component="button"
      type="button"
      aria-label={label()}
      title={label()}
      data-testid={`options-${props.optionType.toLowerCase()}-${props.strike}-chart`}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        props.onChart(props.strike, props.optionType, props.leg);
      }}
      className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-text"
    >
      <IconChartLine size={12} />
    </Box>
  );
}

/** A clickable price cell: buy on click, sell on shift-click. */
function PriceCell(props: {
  leg: ChainLeg;
  optionType: "CE" | "PE";
  strike: number;
  onPick?: (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => void;
  onChart?: (strike: number, type: "CE" | "PE", leg: ChainLeg) => void;
  align?: "right" | "left";
}) {
  const priceText = () => (props.leg.ltp == null ? DASH : props.leg.ltp.toFixed(1));
  // Voice control activates this cell by the number it shows, so the visible
  // price has to lead the accessible name; the trade affordance follows it.
  const label = () =>
    `${priceText()} — ${props.optionType === "CE" ? "Call" : "Put"} ${props.strike} · buy · shift-click to sell`;
  return (
    <Box className="flex w-full min-w-0 items-center justify-end gap-2">
      <Box
        component="button"
        type="button"
        aria-label={label()}
        title={label()}
        data-testid={`options-${props.optionType.toLowerCase()}-${props.strike}`}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          props.onPick?.(props.strike, props.optionType, props.leg, event.shiftKey ? "sell" : "buy");
        }}
        className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 font-mono tabular-nums text-ui-micro leading-[14px] text-fin-text hover:text-fin-primary"
        style={{ "text-align": props.align ?? "right" }}
      >
        {priceText()}
      </Box>
      <Show when={props.onChart}>
        {(onChart) => (
          <ChartButton
            leg={props.leg}
            optionType={props.optionType}
            strike={props.strike}
            onChart={onChart()}
          />
        )}
      </Show>
    </Box>
  );
}

/**
 * A one-`div` OI bar, no canvas. Open interest is heavy-tailed — a single 1.4M
 * strike flattens every other bar to a hairline under a linear `oi / max` map —
 * so the length uses a square-root scale and reads as a visual rank, not a
 * proportion. The printed number stays exact; `min-width` keeps a near-zero OI
 * a visible tick.
 */
function OiCell(props: { value: number | null | undefined; max: number; side: "ce" | "pe" }) {
  const present = () => props.value != null && Number.isFinite(props.value);
  const pct = () => {
    const max = props.max;
    if (!(max > 0) || !present()) return 0;
    const ratio = Math.max(0, Math.min(1, (props.value as number) / max));
    return Math.min(100, Math.sqrt(ratio) * 100);
  };
  // The bar is a 2px rail under the number, not a solid block behind it:
  // TEXT on the solid POSITIVE / NEGATIVE fills measures ~2.6:1. The low-alpha
  // area keeps the magnitude readable while the rail carries the solid token
  // (see src/utils/contrast.ts and src/test/contrast.test.ts).
  const fill = () => (props.side === "ce" ? palette.OI_CALL : palette.OI_PUT);
  const valueKey = props.value ?? "missing";
  return (
    <Box className="relative flex h-[13px] w-full items-center justify-end">
      <Box
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[2px]"
        style={{ "background-color": palette.alpha(palette.TEXT, 0.06) }}
      />
      <Box
        aria-hidden="true"
        data-testid={`options-oi-tint-${props.side}-${valueKey}`}
        className="absolute bottom-0 right-0 h-[13px]"
        style={{
          width: `${pct()}%`,
          "min-width": "2px",
          "background-color": palette.alpha(fill(), 0.14),
        }}
      />
      <Box
        aria-hidden="true"
        data-testid={`options-oi-bar-${props.side}-${valueKey}`}
        className="absolute bottom-0 right-0 h-[2px]"
        style={{
          width: `${pct()}%`,
          "min-width": "2px",
          "background-color": fill(),
        }}
      />
      <span
        className={`${CELL} relative`}
        aria-label={present() ? undefined : "unpriced"}
      >
        {present() ? formatNumber(props.value as number) : DASH}
      </span>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/* Strike level badges                                                 */
/* ------------------------------------------------------------------ */

export type BadgeCode = "MP" | "CW" | "PW" | "SUP" | "RES" | "FU";

/** Highest priority first — one badge per strike, never a duplicate label. */
export const BADGE_PRIORITY: readonly BadgeCode[] = ["MP", "CW", "PW", "SUP", "RES", "FU"];

const BADGE_SPECS: Record<BadgeCode, { label: string; letter: string; color: string }> = {
  MP: { label: "MP", letter: "M", color: palette.LEVEL_MAX_PAIN },
  CW: { label: "CW", letter: "C", color: palette.LEVEL_CALL_WALL },
  PW: { label: "PW", letter: "P", color: palette.LEVEL_PUT_WALL },
  SUP: { label: "SUP", letter: "S", color: palette.LEVEL_SUPPORT },
  RES: { label: "RES", letter: "R", color: palette.LEVEL_RESISTANCE },
  // Gamma fuel is opt-in: it never gets a visible chip/letter, only a rail.
  FU: { label: "", letter: "", color: palette.INFO },
};

export interface StrikeBadge {
  code: BadgeCode;
  /** Wide chip text — empty for fuel. */
  label: string;
  /** 390px letter — empty for fuel. */
  letter: string;
  color: string;
  /** Every code sharing this strike, priority order (for the tooltip). */
  codes: BadgeCode[];
  title: string;
}

function levelDetail(name: string, level: ChainLevel): string {
  const strength =
    level.strength != null && Number.isFinite(level.strength)
      ? `${Math.round(level.strength * 100)}% confidence`
      : "strength unavailable";
  const parts = [`${name} ${level.strike.toLocaleString("en-IN")}`, strength];
  if (level.side) parts.push(`${level.side} spot`);
  if (level.oi != null) parts.push(`OI ${formatNumber(level.oi)}`);
  else if (level.payout != null) parts.push(`payout ${formatNumber(level.payout)}`);
  else if (level.netGex != null) parts.push(`net GEX ${level.netGex.toFixed(2)}`);
  return parts.join(" · ");
}

/**
 * Build the whole strike→badge map once per table render. Priority is applied
 * by visiting candidates high→low and keeping the first per strike; later
 * levels at the same strike only enrich the tooltip.
 */
export function buildStrikeBadges(levels: OptionChainLevels | null | undefined): Map<number, StrikeBadge> {
  // Collect candidates per code, then visit them in BADGE_PRIORITY order so the
  // constant stays the single source of truth for which badge wins a strike.
  const candidates = new Map<BadgeCode, { name: string; level: ChainLevel }[]>();
  const add = (code: BadgeCode, name: string, level: ChainLevel | null | undefined) => {
    if (!level) return;
    const list = candidates.get(code);
    const entry = { name, level };
    if (list) list.push(entry);
    else candidates.set(code, [entry]);
  };

  add("MP", "Max pain", levels?.maxPain);
  add("CW", "Call wall", levels?.callWall);
  add("PW", "Put wall", levels?.putWall);
  add("SUP", "Gamma support", levels?.gex?.support);
  add("RES", "Gamma resistance", levels?.gex?.resistance);
  add("FU", "Gamma fuel up", levels?.gex?.fuelUp);
  add("FU", "Gamma fuel down", levels?.gex?.fuelDown);

  const groups = new Map<number, { code: BadgeCode; name: string; level: ChainLevel }[]>();
  for (const code of BADGE_PRIORITY) {
    for (const { name, level } of candidates.get(code) ?? []) {
      const group = groups.get(level.strike);
      const entry = { code, name, level };
      if (group) group.push(entry);
      else groups.set(level.strike, [entry]);
    }
  }

  const badges = new Map<number, StrikeBadge>();
  for (const [strike, group] of groups) {
    const primary = group[0];
    const spec = BADGE_SPECS[primary.code];
    badges.set(strike, {
      code: primary.code,
      label: spec.label,
      letter: spec.letter,
      color: spec.color,
      codes: [...new Set(group.map((entry) => entry.code))],
      title: group.map((entry) => levelDetail(entry.name, entry.level)).join(" · "),
    });
  }
  return badges;
}

/** Wide: an 11px chip beside the strike number; fuel is a rail-only marker. */
function WideBadge(props: { badge: StrikeBadge; strike: number }) {
  return (
    <Box
      component="span"
      data-testid={`options-strike-badge-${props.strike}`}
      data-code={props.badge.code}
      title={props.badge.title}
      aria-label={props.badge.title}
      className="ml-2 inline-flex shrink-0 items-center font-mono tabular-nums text-ui-micro leading-[14px]"
      style={{ color: props.badge.color }}
    >
      <Show when={props.badge.label} fallback={<span className="inline-block h-[14px] w-[2px]" style={{ "background-color": props.badge.color }} aria-hidden="true" />}>
        {props.badge.label}
      </Show>
    </Box>
  );
}

/** 390px: no text chip — a 2px tinted rail plus one uppercase letter. */
function NarrowBadge(props: { badge: StrikeBadge; strike: number }) {
  return (
    <Box
      component="span"
      role="img"
      data-testid={`options-strike-badge-${props.strike}`}
      data-code={props.badge.code}
      data-letter={props.badge.letter}
      title={props.badge.title}
      aria-label={props.badge.title}
      className="absolute left-0 top-0 flex h-full items-start"
    >
      <span className="h-full shrink-0" style={{ width: "2px", "background-color": props.badge.color }} aria-hidden="true" />
      <Show when={props.badge.letter}>
        <span
          className="absolute left-2 top-0 font-mono tabular-nums text-ui-micro leading-[14px]"
          style={{ color: props.badge.color }}
          aria-hidden="true"
        >
          {props.badge.letter}
        </span>
      </Show>
    </Box>
  );
}

export function StrikeBadgeView(props: { badge: StrikeBadge; strike: number; narrow: boolean }) {
  return (
    <Show when={!props.narrow} fallback={<NarrowBadge badge={props.badge} strike={props.strike} />}>
      <WideBadge badge={props.badge} strike={props.strike} />
    </Show>
  );
}

export interface ChainColumnHandlers {
  /** Largest OI on either side — the OI bar denominator. */
  maxOi: () => number;
  /** Strike nearest spot, or null when there is no quote — drives the ATM marker. */
  atmStrike: () => number | null;
  onPick?: (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => void;
  /** Opens the per-contract chart beside the LTP, without adding a leg. */
  onChart?: (strike: number, type: "CE" | "PE", leg: ChainLeg) => void;
  /** Restrict the narrow layout to one side plus the strike. Default: all nine. */
  side?: "CE" | "PE";
  /** Precomputed once per table render — never derive levels inside a cell. */
  badgeFor?: (strike: number) => StrikeBadge | undefined;
  narrow?: boolean;
}

export function chainColumns(handlers: ChainColumnHandlers): TableColumnDef<ChainRow>[] {
  const ceIn = (row: ChainRow) => row.ce;
  const peIn = (row: ChainRow) => row.pe;

  const columnDefs: TableColumnDef<ChainRow>[] = [
    {
      id: "ce_oi",
      header: "OI",
      size: 54,
      meta: { align: "right" },
      accessorFn: (row) => row.ce.oi,
      cell: ({ row }) => <OiCell value={row.original.ce.oi} max={handlers.maxOi()} side="ce" />,
    },
    {
      id: "ce_iv",
      header: "IV",
      size: 38,
      meta: { align: "right" },
      accessorFn: (row) => row.ce.iv,
      cell: ({ row }) => <NumericCell value={fmtIv(row.original.ce.iv)} />,
    },
    {
      id: "ce_delta",
      header: "Δ",
      size: 34,
      meta: { align: "right" },
      accessorFn: (row) => row.ce.delta,
      cell: ({ row }) => <NumericCell value={fmtGreek(row.original.ce.delta, 2)} />,
    },
    {
      id: "ce_ltp",
      header: "LTP",
      size: 64,
      meta: { align: "right" },
      accessorFn: (row) => row.ce.ltp,
      cell: ({ row }) => (
        <PriceCell
          leg={ceIn(row.original)}
          optionType="CE"
          strike={row.original.strike}
          onPick={handlers.onPick}
          onChart={handlers.onChart}
        />
      ),
    },
    {
      id: "strike",
      header: "STRIKE",
      size: 72,
      meta: { align: "center" },
      accessorFn: (row) => row.strike,
      cell: ({ row }) => {
        const isAtm = row.original.strike === handlers.atmStrike();
        const badge = () => handlers.badgeFor?.(row.original.strike);
        return (
          <span
            className={`${STRIKE_CELL} ${isAtm ? "text-fin-primary" : "text-fin-text-muted"}`}
            data-testid={`options-strike-cell-${row.original.strike}`}
          >
            <Show when={isAtm}>
              <span role="img" aria-label={`At the money strike ${row.original.strike}`} data-testid={`options-atm-marker-${row.original.strike}`}>
                ◀
              </span>
            </Show>
            <Show when={badge()}>
              {(value) => (
                <StrikeBadgeView badge={value()} strike={row.original.strike} narrow={handlers.narrow ?? false} />
              )}
            </Show>
            <span>{row.original.strike.toLocaleString("en-IN")}</span>
          </span>
        );
      },
    },
    {
      id: "pe_ltp",
      header: "LTP",
      size: 64,
      meta: { align: "right" },
      accessorFn: (row) => row.pe.ltp,
      cell: ({ row }) => (
        <PriceCell
          leg={peIn(row.original)}
          optionType="PE"
          strike={row.original.strike}
          onPick={handlers.onPick}
          onChart={handlers.onChart}
        />
      ),
    },
    {
      id: "pe_delta",
      header: "Δ",
      size: 34,
      meta: { align: "right" },
      accessorFn: (row) => row.pe.delta,
      cell: ({ row }) => <NumericCell value={fmtGreek(row.original.pe.delta, 2)} />,
    },
    {
      id: "pe_iv",
      header: "IV",
      size: 38,
      meta: { align: "right" },
      accessorFn: (row) => row.pe.iv,
      cell: ({ row }) => <NumericCell value={fmtIv(row.original.pe.iv)} />,
    },
    {
      id: "pe_oi",
      header: "OI",
      size: 54,
      meta: { align: "right" },
      accessorFn: (row) => row.pe.oi,
      cell: ({ row }) => <OiCell value={row.original.pe.oi} max={handlers.maxOi()} side="pe" />,
    },
  ];

  // The narrow one-sided layout keeps the same definitions (sizes/alignments
  // untouched) and only selects a subset. Filtering preserves declaration
  // order, so the PE set still reads `STRIKE | LTP Δ IV OI`.
  if (handlers.side === "CE") {
    return columnDefs.filter((col) =>
      ["ce_oi", "ce_iv", "ce_delta", "ce_ltp", "strike"].includes(col.id),
    );
  }
  if (handlers.side === "PE") {
    return columnDefs.filter((col) =>
      ["strike", "pe_ltp", "pe_delta", "pe_iv", "pe_oi"].includes(col.id),
    );
  }
  return columnDefs;
}
