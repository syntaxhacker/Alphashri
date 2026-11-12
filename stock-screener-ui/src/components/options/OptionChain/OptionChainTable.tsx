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
} from "@/ui";
import * as palette from "@/ui/palette";
import { createEffect, createMemo, createSignal, For, Index, Show, type CSSProperties } from "solid-js";
import { getMoneyness } from "../../../utils/options";
import { clamp, formatNumber, getPnLTextColor } from "../../../utils/ui-helpers";
import type { OptionContract } from "../../../api/upstoxOptions";
import { hexToRgba, getCellPalette, type CellKind } from "./cellPalette";
import { getStyles } from "./chainStyles";
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
}) {
  const { isDark } = useColorScheme();
  const styles = getStyles(props.theme, isDark());
  const type = () => props.type;
  const strike = () => props.rowStrike;

  const m = createMemo(() => props.contract?.market_data);
  const g = createMemo(() => props.contract?.option_greeks);

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
              c: isITM ? (props.type === "CE" ? "success" : "error") : undefined,
              isLTP: true,
              title: `LTP ₹${ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            },
          ]
        : [
            {
              value: ltp.toFixed(2),
              kind: "ltp",
              fw: 700,
              c: isITM ? (props.type === "CE" ? "success" : "error") : undefined,
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
        <Group justify="space-between" style={{ "margin-bottom": 8 }}>
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
        <Box style={{ "margin-top": 8, "padding-top": 8 }}>
          <Text size="sm">Delta: {d.delta.toFixed(3)}</Text>
          <Text size="sm">Theta: {(d.gr?.theta ?? 0).toFixed(2)}</Text>
          <Text size="sm">Gamma: {(d.gr?.gamma ?? 0).toFixed(5)}</Text>
          <Text size="sm">Vega: {(d.gr?.vega ?? 0).toFixed(2)}</Text>
          <Text size="sm">IV: {d.iv.toFixed(2)}%</Text>
        </Box>
        <Box style={{ "margin-top": 8, "padding-top": 8 }}>
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
        <For each={[1, 2, 3, 4, 5]}>
          {() => <Box style={styles.cell as CSSProperties}>-</Box>}
        </For>
      </Box>
    }>
      {(d) => (
        <>
          <For each={d().cellMeta}>
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

              const cellStyle: CSSProperties = {
                ...(styles.cell as CSSProperties),
                position: "relative",
                "font-weight": cell.fw,
                background: cellPalette.background as string,
                "box-shadow": cellPalette.shadow,
                color: cell.c ? undefined : cellPalette.text,
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
                          top: 4,
                          bottom: 4,
                          [type() === "CE" ? "right" : "left"]: 0,
                          width: `${d().oiBarPct}%`,
                          background: `linear-gradient(180deg, ${hexToRgba(cellPalette.accent, 0.22)} 0%, ${hexToRgba(cellPalette.accent, 0.08)} 100%)`,
                          "border-radius": type() === "CE" ? "999px 0 0 999px" : "0 999px 999px 0",
                          "z-index": 0,
                          transition: "width 0.35s ease",
                        }}
                      />
                    </Show>

                    <Show when={cell.isVol}>
                      <Box
                        data-testid={`options-vol-bar-${type()}-${strike()}`}
                        title={`Volume ${d().volBarPct.toFixed(0)}% of column max`}
                        style={{
                          position: "absolute",
                          top: 4,
                          bottom: 4,
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
                          style={cell.c ? undefined : { color: cellPalette.text }}
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
                              px={4}
                              style={{ "font-size": "10px", height: 14 }}
                            >
                              {badge().label}
                            </Badge>
                          )}
                        </Show>
                      </Group>

                      <Show when={cell.isLTP}>
                        <Box style={{ width: "72%", "margin-top": 4 }}>
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
  const styles = getStyles(theme, isDark());

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

  // NOTE: no auto-scroll on load. The ATM ±window keeps ATM in view, and
  // programmatic scrolling escapes to the page scroller (AppLayout shell),
  // burying the toolbar. Users re-center via the Jump-to-ATM button, which
  // scrolls the table viewport only (see scrollToATM).

  return (
    <Box
      id="option-chain-table"
      style={{ ...(styles.container as CSSProperties), position: "relative" }}
      data-testid="options-chain-table"
    >
      <ChainScrollActions scrollToATM={scrollToATM} scrollToEdge={scrollToEdge} />

      <Box style={styles.windowBar as CSSProperties}>
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

      <ChainTableHeader theme={theme} styles={styles} />
      <ChainSubHeader styles={styles} />

      <div
        ref={(el) => (viewportRef = el)}
        style={{ flex: 1, "min-height": 0, overflow: "auto" }}
        data-testid="options-chain-table-scrollarea"
      >
        <Box style={{ "min-width": 800, "padding-bottom": 152 } as CSSProperties}>
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
                const rowCallBg = `rgba(63, 185, 80, ${0.04 + prox * 0.09 + (hovered ? 0.05 : 0) + (ceITM() ? 0.08 : 0)})`;
                const rowPutBg = `rgba(248, 81, 73, ${0.04 + prox * 0.09 + (hovered ? 0.05 : 0) + (peITM() ? 0.08 : 0)})`;
                const style: CSSProperties = {
                  ...(styles.row as CSSProperties),
                  ...(isZebra() ? (styles.zebraRow as CSSProperties) : {}),
                  ...(isATM() ? (styles.atmRow as CSSProperties) : {}),
                  background: `linear-gradient(90deg, ${rowCallBg} 0%, transparent 37%, ${isATM() ? `rgba(240, 136, 62, ${0.12 + prox * 0.12})` : "transparent"} 50%, transparent 63%, ${rowPutBg} 100%)`,
                };
                if (hovered) {
                  style["box-shadow"] = `inset 0 0 0 1px rgba(240, 136, 62, 0.5), 0 6px 16px rgba(0, 0, 0, 0.08)`;
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
                  />

                  <Box
                    style={{
                      ...(styles.strikeCell as CSSProperties),
                      ...(isATM() ? (styles.atmHighlight as CSSProperties) : {}),
                      ...(isHovered()
                        ? {
                            "box-shadow": `inset 0 0 0 1px rgba(240, 136, 62, 0.45), 0 8px 22px rgba(0, 0, 0, 0.08)`,
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
                    {/* CE-vs-PE dominance micro-bar: green/red split of strike OI */}
                    <Box
                      data-testid={`options-dominance-${strike()}`}
                      title={`CE ${ceSharePct().toFixed(0)}% / PE ${(100 - ceSharePct()).toFixed(0)}% of strike OI`}
                      style={{
                        display: "flex",
                        width: "100%",
                        height: 4,
                        "border-radius": 4,
                        overflow: "hidden",
                        "margin-top": 2,
                        "background-color": palette.BORDER,
                      }}
                    >
                      <Box style={{ width: `${ceSharePct()}%`, "background-color": palette.POSITIVE }} />
                      <Box style={{ width: `${100 - ceSharePct()}%`, "background-color": palette.NEGATIVE }} />
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
