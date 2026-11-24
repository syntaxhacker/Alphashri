import { formatNumberIN } from "@/utils/ui-helpers";
import {
  Box,
  Text,
  Tooltip,
  Group,
  Badge,
  Progress,
  Stack,
  SegmentedControl,
  useColorScheme,
  useTheme,
  useMediaQuery,
  typeSize,
} from "@/ui";
import * as palette from "@/ui/palette";
import { createEffect, createMemo, createSignal, For, Index, Show, type JSX } from "solid-js";
type CSSProperties = JSX.CSSProperties;
import { getMoneyness } from "../../../utils/options";
import { clamp, formatNumber, getPnLTextColor } from "../../../utils/ui-helpers";
import type { OptionContract } from "../../../api/upstoxOptions";
import { hexToRgba, getCellPalette, type CellKind } from "./cellPalette";
import { CHAIN_TABLE_MIN_WIDTH, CHAIN_COMPACT_QUERY, getStyles } from "./chainStyles";
import { ChainTableHeader } from "./ChainTableHeader";
import { ChainSubHeader } from "./ChainSubHeader";
import { ChainFooter } from "./ChainFooter";
import { ChainScrollActions } from "./ChainScrollActions";

/** Bid/ask line for a contract's market data (used by the quote tooltip/tests). */
export function formatQuoteLine(m: { bid_price?: number; ask_price?: number; bid_qty?: number; ask_qty?: number } | null | undefined): string {
  const bidQty = m?.bid_qty ?? 0;
  const askQty = m?.ask_qty ?? 0;
  return `Bid: ${m?.bid_price ?? 0} x ${bidQty} | Ask: ${m?.ask_price ?? 0} x ${askQty}`;
}

export type AtmWindow = "all" | "5" | "10";

export const ATM_WINDOW_OPTIONS = [
  { value: "all", label: "All" },
  { value: "5", label: "ATM ±5" },
  { value: "10", label: "ATM ±10" },
] as Array<{ value: AtmWindow; label: string }>;

/** Index of the strike closest to spot (the ATM row). -1 when unknown. */
export function findAtmIndex(strikes: number[], spotPrice: number | null): number {
  if (spotPrice === null || spotPrice === undefined || strikes.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < strikes.length; i += 1) {
    if (Math.abs(strikes[i] - spotPrice) < Math.abs(strikes[best] - spotPrice)) best = i;
  }
  return best;
}

interface OptionChainTableProps {
  strikeMatrix: Array<{ strike: number; ce: OptionContract | null; pe: OptionContract | null }>;
  filters: any;
  spotPrice: number | null;
  onRowClick: (contract: OptionContract) => void;
  /** Expiry key (e.g. "25MAY") — re-centers on ATM when it changes. */
  selectedExpiry?: string;
}

function OptionColumn(props: {
  contract: OptionContract | null;
  type: "CE" | "PE";
  spotPrice: number | null;
  maxOI: number;
  maxVolume: number;
  onRowClick: (c: OptionContract) => void;
  theme: ReturnType<typeof useTheme>;
  isHovered: boolean;
  rowStrike: number;
  compact?: boolean;
  narrow?: boolean;
}) {
  const { isDark } = useColorScheme();
  const styles = createMemo(() =>
    getStyles(props.theme, isDark(), { compact: props.compact, narrow: props.narrow }),
  );
  const type = () => props.type;
  const strike = () => props.rowStrike;
  // Side coding: CE blue, PE orange. OI is not bullish/bearish, so the legacy
  // green/red pair has no place here (see docs/COLOR_SEMANTICS.md).
  const sideFill = props.type === "CE" ? palette.OI_CALL : palette.OI_PUT;

  const m = createMemo(() => props.contract?.market_data);

  const ltpNow = () => m()?.ltp ?? 0;
  const oiNow = () => m()?.oi ?? 0;
  const volNow = () => m()?.volume ?? 0;
  const chgNow = () => oiNow() - (m()?.prev_oi ?? 0);

  // Inline tick-flash: diff this side's quotes across polls so changed cells
  // pulse in place instead of silently re-rendering. fq toggles restart CSS.
  const [flash, setFlash] = createSignal<{ ltp: "up" | "down" | null; pulse: number; fq: number }>({
    ltp: null,
    pulse: 0,
    fq: 0,
  });
  let prev = { ltp: 0, oi: 0, vol: 0, chg: 0, init: false };

  createEffect(() => {
    const ltp = ltpNow();
    const oi = oiNow();
    const vol = volNow();
    const chg = chgNow();
    const ltpDir = !prev.init ? null : ltp > prev.ltp ? "up" : ltp < prev.ltp ? "down" : null;
    const othersChanged = prev.init && (oi !== prev.oi || vol !== prev.vol || chg !== prev.chg);
    prev = { ltp, oi, vol, chg, init: true };
    if (ltpDir || othersChanged) {
      setFlash((f) => ({
        ltp: ltpDir,
        pulse: othersChanged ? f.pulse + 1 : f.pulse,
        fq: f.fq + 1,
      }));
    }
  });

  const flashClassFor = (kind: CellKind): string | undefined => {
    if (kind === "ltp") {
      return flash().ltp ? `price-flash-${flash().ltp} fq${flash().fq % 2}` : undefined;
    }
    if ((kind === "oi" || kind === "volume" || kind === "change") && flash().pulse > 0) {
      return `price-flash-chg fq${flash().pulse % 2}`;
    }
    return undefined;
  };

  const contract = () => props.contract;

  const meta = createMemo(() => {
    const c = contract();
    if (!c) return null;
    const md = c.market_data;
    const gr = c.option_greeks;
    const st = c.strike_price;
    const moneyness = props.spotPrice ? getMoneyness(st, props.spotPrice, props.type) : "OTM";
    const isITM = moneyness === "ITM";
    const isATM = moneyness === "ATM";
    const atmProximity = props.spotPrice
      ? clamp(1 - Math.min(Math.abs(st - props.spotPrice) / 220, 1), 0, 1)
      : 0;

    const oi = md?.oi ?? 0;
    const prevOi = md?.prev_oi ?? 0;
    const oiChange = oi - prevOi;
    const oiChangePct = prevOi > 0 ? (oiChange / prevOi) * 100 : 0;
    // Direction glyph for at-a-glance scanning (value uses abs to avoid "--" double signs).
    const oiChangeText = `${oiChange > 0 ? "▲ " : oiChange < 0 ? "▼ " : ""}${formatNumber(Math.abs(oiChange))}`;
    const volume = md?.volume ?? 0;
    const ltp = md?.ltp ?? 0;
    const iv = gr?.iv ?? 0;
    const delta = gr?.delta ?? 0;

    const sentiment = c.sentiment || { type: "Neutral", color: "gray", label: "Neutral" };
    const cellMeta = (
      props.type === "CE"
        ? [
            { value: formatNumber(oi), kind: "oi", isOI: true, title: `OI ${formatNumberIN(oi)}` },
            {
              value: oiChangeText,
              kind: "change",
              c: getPnLTextColor(oiChange),
              badge: sentiment.label !== "Neutral" ? sentiment : undefined,
              positive: oiChange >= 0,
              title: `OI change ${formatNumberIN(oiChange)} (${oiChangePct.toFixed(2)}%)`,
            },
            { value: formatNumber(volume), kind: "volume", isVol: true, title: `Volume ${formatNumberIN(volume)}` },
            { value: iv.toFixed(1), kind: "iv", c: "dimmed", title: `IV ${iv.toFixed(2)}%` },
            {
              value: ltp.toFixed(2),
              kind: "ltp",
              fw: 700,
              c: isITM ? "warning" : undefined,
              isLTP: true,
              title: `LTP ₹${ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            },
          ]
        : [
            {
              value: ltp.toFixed(2),
              kind: "ltp",
              fw: 700,
              c: isITM ? "warning" : undefined,
              isLTP: true,
              title: `LTP ₹${ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            },
            { value: iv.toFixed(1), kind: "iv", c: "dimmed", title: `IV ${iv.toFixed(2)}%` },
            { value: formatNumber(volume), kind: "volume", isVol: true, title: `Volume ${formatNumberIN(volume)}` },
            {
              value: oiChangeText,
              kind: "change",
              c: getPnLTextColor(oiChange),
              badge: sentiment.label !== "Neutral" ? sentiment : undefined,
              positive: oiChange >= 0,
              title: `OI change ${formatNumberIN(oiChange)} (${oiChangePct.toFixed(2)}%)`,
            },
            { value: formatNumber(oi), kind: "oi", isOI: true, title: `OI ${formatNumberIN(oi)}` },
          ]
    ) as Array<{
      value: string;
      kind: CellKind;
      c?: string;
      badge?: { type: string; color: string; label: string };
      isOI?: boolean;
      isVol?: boolean;
      isLTP?: boolean;
      fw?: number;
      positive?: boolean;
      title?: string;
    }>;

    const oiBarPct = clamp((oi / Math.max(props.maxOI, 1)) * 100, 0, 100);
    const volBarPct = clamp((volume / Math.max(props.maxVolume, 1)) * 100, 0, 100);

    const sideIntensity = clamp(
      0.14 + atmProximity * 0.22 + (isATM ? 0.08 : 0) + (props.isHovered ? 0.06 : 0),
      0.12,
      0.42,
    );
    const volumeIntensity = props.maxVolume > 0 ? clamp(volume / props.maxVolume, 0, 1) : 0;

    return {
      contract: c, md, gr, st, isITM, isATM, atmProximity, oi, volume, ltp, iv, delta,
      oiChangePct, oiChange, oiBarPct, volBarPct, sideIntensity, volumeIntensity, cellMeta, sentiment,
    };
  });

  const tooltipContent = createMemo(() => {
    const d = meta();
    if (!d) return null;
    return (
      <Box p="xs">
        <Group justify="space-between" style={{ "margin-bottom": "8px" }}>
          <Text size="sm" fw={700}>
            {d.contract.trading_symbol}
          </Text>
          <Badge size="sm" color={d.sentiment.color} variant="filled">
            {d.sentiment.type}
          </Badge>
        </Group>
        <Text size="sm">
          OI: {d.oi.toLocaleString()} ({d.oiChange >= 0 ? "+" : ""}
          {d.oiChange.toLocaleString()})
        </Text>
        <Text size="sm" c={getPnLTextColor(d.oiChange)}>
          OI Change %: {d.oiChangePct.toFixed(2)}%
        </Text>
        <Box style={{ "margin-top": "8px", "padding-top": "8px" }}>
          <Text size="sm">Delta: {d.delta.toFixed(3)}</Text>
          <Text size="sm">Theta: {(d.gr?.theta ?? 0).toFixed(2)}</Text>
          <Text size="sm">Gamma: {(d.gr?.gamma ?? 0).toFixed(5)}</Text>
          <Text size="sm">Vega: {(d.gr?.vega ?? 0).toFixed(2)}</Text>
          <Text size="sm">IV: {d.iv.toFixed(2)}%</Text>
        </Box>
        <Box style={{ "margin-top": "8px", "padding-top": "8px" }}>
          <Text size="sm">
            Bid: {d.md?.bid_price} | Ask: {d.md?.ask_price}
          </Text>
        </Box>
      </Box>
    );
  });

  return (
    <Show when={meta()} fallback={
      <Box style={{ display: "contents" }}>
        <For each={props.compact ? [1, 2] : [1, 2, 3, 4, 5]}>
          {() => <Box style={styles().cell as CSSProperties}>-</Box>}
        </For>
      </Box>
    }>
      {(d) => (
        <>
          <For each={props.compact ? d().cellMeta.filter((cell) => cell.isLTP || cell.isOI) : d().cellMeta}>
            {(cell) => {
              const kindIntensity = (
                cell.kind === "oi"
                  ? clamp((d().oi / Math.max(props.maxOI, 1)) * 1.1 + d().sideIntensity, 0.12, 1)
                  : cell.kind === "change"
                    ? clamp(Math.abs(d().oiChangePct) / 35 + d().sideIntensity * 0.7, 0.12, 1)
                    : cell.kind === "volume"
                      ? clamp(d().volumeIntensity * 0.9 + 0.12, 0.1, 1)
                      : cell.kind === "iv"
                        ? clamp((d().iv / 100) * 0.9 + 0.14, 0.1, 1)
                        : clamp(Math.abs(d().delta) * 0.9 + 0.16, 0.1, 1)
              );
              const cellPalette = getCellPalette(
                props.theme,
                cell.kind,
                type(),
                kindIntensity,
                props.isHovered,
                d().isATM,
                d().isITM,
                cell.positive,
              );

              const isOiCell = cell.kind === "oi";
              // getCellPalette is the legacy green/red side ramp. For OI cells
              // override it with a ≤14% side tint and surface ink so the number
              // stays readable (2px rail below carries the solid token).
              const oiTint = palette.alpha(sideFill, clamp(0.08 + kindIntensity * 0.06, 0.08, 0.14));
              const cellBackground = isOiCell ? oiTint : (cellPalette.background as string);
              const cellText = isOiCell ? palette.TEXT : cellPalette.text;
              const cellShadow = isOiCell
                ? `inset 0 0 0 1px ${palette.alpha(sideFill, 0.28)}`
                : cellPalette.shadow;

              const cellStyle: CSSProperties = {
                ...(styles().cell as CSSProperties),
                position: "relative",
                "font-weight": cell.fw,
                background: cellBackground,
                "box-shadow": cellShadow,
                color: cell.c ? undefined : cellText,
              };

              return (
                <Tooltip
                  openDelay={300}
                  label={tooltipContent()}
                  position="top"
                  withArrow
                  multiline
                >
                  <Box style={cellStyle} title={cell.title} onClick={() => d().contract && props.onRowClick(d().contract)}>
                    <Show when={cell.isOI}>
                      <Box
                        data-testid={`options-oi-bar-${type()}-${strike()}`}
                        title={`OI ${d().oiBarPct.toFixed(0)}% of column max`}
                        style={{
                          position: "absolute",
                          top: "4px",
                          bottom: "4px",
                          [type() === "CE" ? "right" : "left"]: 0,
                          width: `${d().oiBarPct}%`,
                          "background-color": palette.alpha(sideFill, 0.14),
                          "border-radius": type() === "CE" ? "999px 0 0 999px" : "0 999px 999px 0",
                          "z-index": 0,
                          transition: "width 0.35s ease",
                        }}
                      >
                        <Box
                          aria-hidden="true"
                          data-testid={`options-oi-rail-${type()}-${strike()}`}
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            [type() === "CE" ? "right" : "left"]: 0,
                            width: "2px",
                            "background-color": sideFill,
                            "border-radius": type() === "CE" ? "999px 0 0 999px" : "0 999px 999px 0",
                          }}
                        />
                      </Box>
                    </Show>

                    <Show when={cell.isVol}>
                      <Box
                        data-testid={`options-vol-bar-${type()}-${strike()}`}
                        title={`Volume ${d().volBarPct.toFixed(0)}% of column max`}
                        style={{
                          position: "absolute",
                          top: "4px",
                          bottom: "4px",
                          [type() === "CE" ? "right" : "left"]: 0,
                          width: `${d().volBarPct}%`,
                          background: `linear-gradient(180deg, ${hexToRgba(cellPalette.accent, 0.22)} 0%, ${hexToRgba(cellPalette.accent, 0.08)} 100%)`,
                          "border-radius": type() === "CE" ? "999px 0 0 999px" : "0 999px 999px 0",
                          "z-index": 0,
                          transition: "width 0.35s ease",
                        }}
                      />
                    </Show>

                    <Stack gap={0} align="center" w="100%" style={{ "z-index": "1" }}>
                      <Group gap={4} wrap="nowrap" align="center" justify="center">
                        <Text
                          size="sm"
                          fw={cell.fw}
                          c={cell.c}
                          className={flashClassFor(cell.kind)}
                          style={cell.c ? undefined : { color: cellText }}
                          ta="center"
                          lh={1.05}
                        >
                          {cell.value}
                        </Text>
                        <Show when={cell.badge}>
                          {(badge) => (
                            <Badge
                              size="sm"
                              variant="light"
                              color={badge().color}
                              style={{ "font-size": `${typeSize("micro")}px`, height: "14px", "padding-left": "4px", "padding-right": "4px" }}
                            >
                              {badge().label}
                            </Badge>
                          )}
                        </Show>
                      </Group>

                      <Show when={cell.isLTP}>
                        <Box style={{ width: "72%", "margin-top": "4px" }}>
                          <Progress
                            value={clamp(Math.abs(d().delta) * 100, 0, 100)}
                            size={3}
                            color={cellPalette.accent}
                            radius="xl"
                          />
                        </Box>
                      </Show>
                    </Stack>
                  </Box>
                </Tooltip>
              );
            }}
          </For>
        </>
      )}
    </Show>
  );
}

export function OptionChainTable(props: OptionChainTableProps) {
  const theme = useTheme();
  const { isDark } = useColorScheme();
  const isNarrow = useMediaQuery(CHAIN_COMPACT_QUERY, false);
  // A phone opens on a five-column core view; the 11-column chain stays one
  // tap away so no strike data is hidden without an affordance.
  const [showFullChain, setShowFullChain] = createSignal(false);
  const compact = () => isNarrow() && !showFullChain();
  const styles = createMemo(() =>
    getStyles(theme, isDark(), { narrow: isNarrow(), compact: compact() }),
  );

  let viewportRef: HTMLDivElement | undefined;
  let atmRowRef: HTMLDivElement | undefined;
  const [hoveredStrike, setHoveredStrike] = createSignal<number | null>(null);
  // ATM-first: default to a ±10 strike window so users land near the money
  // instead of scrolling from far-OTM strikes.
  const [atmWindow, setAtmWindow] = createSignal<AtmWindow>("10");

  // ATM strike = closest strike to spot (not a fixed ±25pt band, which breaks
  // on non-50pt step underlyings).
  const atmIndex = createMemo(() =>
    findAtmIndex(props.strikeMatrix.map((s) => s.strike), props.spotPrice),
  );
  const visibleRows = createMemo(() => {
    if (atmWindow() === "all" || atmIndex() < 0) {
      return props.strikeMatrix.map((row, index) => ({ ...row, index }));
    }
    const half = Number(atmWindow());
    return props.strikeMatrix
      .map((row, index) => ({ ...row, index }))
      .filter((row) => Math.abs(row.index - atmIndex()) <= half);
  });

  // In-cell bar widths are % of the *visible* column max, so the longest bar
  // always fills the cell within the current ATM window.
  const maxCE_OI = createMemo(() => Math.max(...visibleRows().map((s) => s.ce?.market_data?.oi ?? 0), 1));
  const maxPE_OI = createMemo(() => Math.max(...visibleRows().map((s) => s.pe?.market_data?.oi ?? 0), 1));
  const maxCE_Volume = createMemo(() => Math.max(...visibleRows().map((s) => s.ce?.market_data?.volume ?? 0), 1));
  const maxPE_Volume = createMemo(() => Math.max(...visibleRows().map((s) => s.pe?.market_data?.volume ?? 0), 1));

  const scrollToATM = (behavior: ScrollBehavior = "smooth") => {
    const atmRow = atmRowRef;
    if (!atmRow) return;
    // Contained: scroll the table viewport only. Native scrollIntoView would
    // escape to the page scroller (AppLayout shell) and bury the toolbar.
    if (viewportRef) {
      const viewport = viewportRef;
      const viewportHeight = viewport.clientHeight;
      const rowTop = atmRow.offsetTop;
      const rowHeight = atmRow.clientHeight;
      const scrollTo = rowTop - viewportHeight / 2 + rowHeight / 2;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top: Math.max(0, scrollTo), behavior });
      } else {
        viewport.scrollTop = Math.max(0, scrollTo);
      }
      return;
    }
    try {
      if (typeof atmRow.scrollIntoView === "function") {
        atmRow.scrollIntoView({ block: "center", behavior });
      }
    } catch {
      /* noop */
    }
  };

  const scrollToEdge = (direction: "top" | "bottom") => {
    if (viewportRef) {
      viewportRef.scrollTo({
        top: direction === "top" ? 0 : viewportRef.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  // On a phone the 11-column grid is 980px wide, so the strike's natural
  // position (centre of that grid) is off-screen at scrollLeft 0. Entering the
  // full chain centres the strike so the first viewport shows CE LTP / STRIKE
  // / PE LTP instead of an unanchored wall of numbers.
  createEffect(() => {
    if (!isNarrow() || !showFullChain()) return;
    queueMicrotask(() => {
      const viewport = viewportRef;
      const strike = viewport?.querySelector(
        '[data-testid="options-chain-strike-header"]',
      ) as HTMLElement | null;
      if (!viewport || !strike) return;
      const viewportBox = viewport.getBoundingClientRect();
      const strikeBox = strike.getBoundingClientRect();
      const offset = strikeBox.left - viewportBox.left;
      const left = viewport.scrollLeft + offset - (viewport.clientWidth - strikeBox.width) / 2;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ left: Math.max(0, left), behavior: "auto" });
      } else {
        viewport.scrollLeft = Math.max(0, left);
      }
    });
  });

  // NOTE: no auto-scroll on load. The ATM ±window keeps ATM in view, and
  // programmatic scrolling escapes to the page scroller (AppLayout shell),
  // burying the toolbar. Users re-center via the Jump-to-ATM button, which
  // scrolls the table viewport only (see scrollToATM).

  return (
    <Box
      id="option-chain-table"
      style={{ ...(styles().container as CSSProperties), position: "relative" }}
      data-mode={compact() ? "compact" : "full"}
      data-testid="options-chain-table"
    >
      {/* The compact view hugs its rows, so the page owns vertical scrolling
          and these viewport-only controls would be no-ops. */}
      <Show when={!compact()}>
        <ChainScrollActions scrollToATM={scrollToATM} scrollToEdge={scrollToEdge} />
      </Show>

      <Box style={styles().windowBar as CSSProperties}>
        <Text size="sm" className="text-fin-text-muted" fw={600}>
          ATM window
        </Text>
        <SegmentedControl
          size="xs"
          value={atmWindow()}
          onChange={(v) => setAtmWindow(v as AtmWindow)}
          data={ATM_WINDOW_OPTIONS}
          data-testid="options-chain-atm-window"
        />
        <Text size="sm" className="text-fin-text-muted" data-testid="options-chain-window-count">
          Showing {visibleRows().length} of {props.strikeMatrix.length} strikes
        </Text>
      </Box>

      <Show when={isNarrow()}>
        <Box
          className="flex w-full items-center justify-between gap-2 px-3 py-1"
          data-testid="options-chain-view-switch"
        >
          <Text size="sm" className="text-fin-text-muted" data-testid="options-chain-core-summary">
            Core · STRIKE / CE·PE LTP / OI
          </Text>
          <button
            type="button"
            aria-pressed={showFullChain()}
            onClick={() => setShowFullChain((value) => !value)}
            className="shrink-0 rounded-[6px] border border-fin-border px-2 py-1 font-mono text-ui-micro text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary"
            data-testid="options-chain-full-chain-toggle"
          >
            {showFullChain() ? "← Compact" : "Full chain →"}
          </button>
        </Box>
      </Show>

      <Box className="flex w-full items-center justify-end px-3 py-1 sm:hidden" data-testid="options-chain-scroll-cue">
        <Text size="sm" className="text-fin-text-muted">
          {isNarrow()
            ? showFullChain()
              ? "Scroll sideways → all 11 columns"
              : "Scroll sideways → Full chain"
            : "Scroll sideways →"}
        </Text>
      </Box>

      {/* One scrollport owns both axes: header, subheader and rows scroll
          horizontally together, while the header pair stays sticky vertically. */}
      <div
        ref={(el) => (viewportRef = el)}
        style={{ flex: compact() ? "none" : 1, "min-height": 0, overflow: "auto", "overscroll-behavior": "contain" }}
        role="region"
        aria-label="Option chain table"
        tabindex={0}
        data-mode={compact() ? "compact" : "full"}
        data-testid="options-chain-table-scrollarea"
      >
        <Box
          style={
            {
              "min-width": compact() ? "0px" : `${CHAIN_TABLE_MIN_WIDTH}px`,
              "padding-bottom": compact() ? "8px" : "152px",
            } as CSSProperties
          }
          data-mode={compact() ? "compact" : "full"}
          data-testid="options-chain-table-inner"
        >
          <ChainTableHeader theme={theme} styles={styles()} />
          <ChainSubHeader styles={styles()} compact={compact()} />
          <Index each={visibleRows()}>
            {(row) => {
              const index = () => row().index;
              const strike = () => row().strike;
              const isATM = () => index() === atmIndex() && atmIndex() >= 0;
              const isHovered = () => hoveredStrike() === strike();
              const isZebra = () => index() % 2 === 1 && !isATM();
              // ITM zones: calls are ITM below spot (left side), puts ITM above
              // spot (right side). ATM keeps its warning outline as the
              // strongest signal on screen.
              const ceITM = () => props.spotPrice != null && strike() < props.spotPrice;
              const peITM = () => props.spotPrice != null && strike() > props.spotPrice;
              const proximity = () =>
                props.spotPrice
                  ? clamp(1 - Math.min(Math.abs(strike() - props.spotPrice) / 220, 1), 0, 1)
                  : 0;
              const ceSharePct = () => {
                const ceRowOI = row().ce?.market_data?.oi ?? 0;
                const peRowOI = row().pe?.market_data?.oi ?? 0;
                const total = ceRowOI + peRowOI;
                return total > 0 ? (ceRowOI / total) * 100 : 50;
              };
              const rowStyle = (): CSSProperties => {
                const prox = proximity();
                const hovered = isHovered();
                const callAlpha = 0.04 + prox * 0.09 + (hovered ? 0.05 : 0) + (ceITM() ? 0.08 : 0);
                const putAlpha = 0.04 + prox * 0.09 + (hovered ? 0.05 : 0) + (peITM() ? 0.08 : 0);
                const rowCallBg = palette.alpha(palette.OI_CALL, callAlpha);
                const rowPutBg = palette.alpha(palette.OI_PUT, putAlpha);
                const atmBg = palette.alpha(palette.WARNING, 0.12 + prox * 0.12);
                const style: CSSProperties = {
                  ...(styles().row as CSSProperties),
                  ...(isZebra() ? (styles().zebraRow as CSSProperties) : {}),
                  ...(isATM() ? (styles().atmRow as CSSProperties) : {}),
                  background: `linear-gradient(90deg, ${rowCallBg} 0%, transparent 37%, ${isATM() ? atmBg : "transparent"} 50%, transparent 63%, ${rowPutBg} 100%)`,
                };
                if (hovered) {
                  style["box-shadow"] = `inset 0 0 0 1px ${palette.alpha(palette.WARNING, 0.5)}, 0 6px 16px ${palette.alpha(palette.BG, 0.08)}`;
                }
                return style;
              };

              return (
                <Box
                  ref={(el: HTMLDivElement) => {
                    if (isATM()) atmRowRef = el;
                  }}
                  className={isATM() ? "chain-row-atm" : undefined}
                  data-atm={isATM() ? "true" : undefined}
                  data-ce-itm={ceITM() ? "true" : undefined}
                  data-pe-itm={peITM() ? "true" : undefined}
                  style={rowStyle()}
                  data-testid={`options-chain-row-${strike()}`}
                  onMouseEnter={() => setHoveredStrike(strike())}
                  onMouseLeave={() =>
                    setHoveredStrike((current) => (current === strike() ? null : current))
                  }
                >
                  <OptionColumn
                    contract={row().ce}
                    type="CE"
                    spotPrice={props.spotPrice}
                    maxOI={maxCE_OI()}
                    maxVolume={maxCE_Volume()}
                    onRowClick={props.onRowClick}
                    theme={theme}
                    isHovered={isHovered()}
                    rowStrike={strike()}
                    compact={compact()}
                    narrow={isNarrow()}
                  />

                  <Box
                    style={{
                      ...(styles().strikeCell as CSSProperties),
                      ...(isATM() ? (styles().atmHighlight as CSSProperties) : {}),
                      ...(isHovered()
                        ? {
                            "box-shadow": `inset 0 0 0 1px ${palette.alpha(palette.WARNING, 0.45)}, 0 8px 22px ${palette.alpha(palette.BG, 0.08)}`,
                          }
                        : undefined),
                    } as CSSProperties}
                    data-testid="strike-cell"
                  >
                    <Text size="sm" fw={800}>
                      {strike()}
                    </Text>
                    <Show when={isATM()}>
                      <Badge
                        size="sm"
                        variant="filled"
                        color="warning"
                        data-testid="options-chain-atm-badge"
                      >
                        ATM
                      </Badge>
                    </Show>
                    {/* CE-vs-PE dominance micro-bar: blue/orange split of strike OI */}
                    <Box
                      data-testid={`options-dominance-${strike()}`}
                      title={`CE ${ceSharePct().toFixed(0)}% / PE ${(100 - ceSharePct()).toFixed(0)}% of strike OI`}
                      style={{
                        display: "flex",
                        width: "100%",
                        height: "4px",
                        "border-radius": "4px",
                        overflow: "hidden",
                        "margin-top": "2px",
                        "background-color": palette.BORDER,
                      }}
                    >
                      <Box style={{ width: `${ceSharePct()}%`, "background-color": palette.OI_CALL }} />
                      <Box style={{ width: `${100 - ceSharePct()}%`, "background-color": palette.OI_PUT }} />
                    </Box>
                  </Box>

                  <OptionColumn
                    contract={row().pe}
                    type="PE"
                    spotPrice={props.spotPrice}
                    maxOI={maxPE_OI()}
                    maxVolume={maxPE_Volume()}
                    onRowClick={props.onRowClick}
                    theme={theme}
                    isHovered={isHovered()}
                    rowStrike={strike()}
                    compact={compact()}
                    narrow={isNarrow()}
                  />
                </Box>
              );
            }}
          </Index>
        </Box>
      </div>

      <ChainFooter theme={theme} colorScheme={isDark() ? "dark" : "light"} spotPrice={props.spotPrice} />
    </Box>
  );
}
