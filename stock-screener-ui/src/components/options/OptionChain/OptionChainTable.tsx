import {
  Box,
  Text,
  Tooltip,
  Group,
  Badge,
  ScrollArea,
  Progress,
  Stack,
  SegmentedControl,
  useColorScheme,
  useTheme,
} from "@/ui";
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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

function OptionColumn({
  contract,
  type,
  spotPrice,
  maxOI,
  maxVolume,
  onRowClick,
  theme,
  isHovered,
  rowStrike,
}: {
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
  const { colorScheme } = useColorScheme();
  const styles = getStyles(theme, colorScheme === "dark");
  // Inline tick-flash: diff this side's quotes across polls so changed cells
  // pulse in place instead of silently re-rendering. fq toggles restart CSS.
  const ltpNow = contract?.market_data?.ltp ?? 0;
  const oiNow = contract?.market_data?.oi ?? 0;
  const volNow = contract?.market_data?.volume ?? 0;
  const chgNow = oiNow - (contract?.market_data?.prev_oi ?? 0);
  const prevRef = useRef({ ltp: ltpNow, oi: oiNow, vol: volNow, chg: chgNow, init: false });
  const [flash, setFlash] = useState<{ ltp: "up" | "down" | null; pulse: number; fq: number }>({
    ltp: null,
    pulse: 0,
    fq: 0,
  });
  useEffect(() => {
    const p = prevRef.current;
    const ltpDir = !p.init ? null : ltpNow > p.ltp ? "up" : ltpNow < p.ltp ? "down" : null;
    const othersChanged = p.init && (oiNow !== p.oi || volNow !== p.vol || chgNow !== p.chg);
    prevRef.current = { ltp: ltpNow, oi: oiNow, vol: volNow, chg: chgNow, init: true };
    if (ltpDir || othersChanged) {
      setFlash((f) => ({
        ltp: ltpDir,
        pulse: othersChanged ? f.pulse + 1 : f.pulse,
        fq: f.fq + 1,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ltpNow, oiNow, volNow, chgNow]);
  const flashClassFor = (kind: CellKind): string | undefined => {
    if (kind === "ltp") {
      return flash.ltp ? `price-flash-${flash.ltp} fq${flash.fq % 2}` : undefined;
    }
    if ((kind === "oi" || kind === "volume" || kind === "change") && flash.pulse > 0) {
      return `price-flash-chg fq${flash.pulse % 2}`;
    }
    return undefined;
  };
  if (!contract) {
    return (
      <Box sx={{ display: "contents" }}>
        {Array(5)
          .fill(0)
          .map((_, i) => (
            <Box key={i} sx={styles.cell}>
              -
            </Box>
          ))}
      </Box>
    );
  }

  const { market_data: m, option_greeks: g, strike_price: strike } = contract;
  const moneyness = spotPrice ? getMoneyness(strike, spotPrice, type) : "OTM";
  const isITM = moneyness === "ITM";
  const isATM = moneyness === "ATM";
  const atmProximity = spotPrice
    ? clamp(1 - Math.min(Math.abs(strike - spotPrice) / 220, 1), 0, 1)
    : 0;

  const oi = m?.oi ?? 0;
  const prevOi = m?.prev_oi ?? 0;
  const oiChange = oi - prevOi;
  const oiChangePct = prevOi > 0 ? (oiChange / prevOi) * 100 : 0;
  // Direction glyph for at-a-glance scanning (value uses abs to avoid "--" double signs).
  const oiChangeText = `${oiChange > 0 ? "▲ " : oiChange < 0 ? "▼ " : ""}${formatNumber(Math.abs(oiChange))}`;
  const volume = m?.volume ?? 0;
  const ltp = m?.ltp ?? 0;
  const iv = g?.iv ?? 0;
  const delta = g?.delta ?? 0;

  const sentiment = contract.sentiment || { type: "Neutral", color: "gray", label: "Neutral" };
  const cellMeta = (
    type === "CE"
      ? [
          { value: formatNumber(oi), kind: "oi", isOI: true, title: `OI ${oi.toLocaleString("en-IN")}` },
          {
            value: oiChangeText,
            kind: "change",
            c: getPnLTextColor(oiChange),
            badge: sentiment.label !== "Neutral" ? sentiment : undefined,
            positive: oiChange >= 0,
            title: `OI change ${oiChange.toLocaleString("en-IN")} (${oiChangePct.toFixed(2)}%)`,
          },
          { value: formatNumber(volume), kind: "volume", isVol: true, title: `Volume ${volume.toLocaleString("en-IN")}` },
          { value: iv.toFixed(1), kind: "iv", c: "dimmed", title: `IV ${iv.toFixed(2)}%` },
          {
            value: ltp.toFixed(2),
            kind: "ltp",
            fw: 700,
            c: isITM ? (type === "CE" ? "green.8" : "red.8") : undefined,
            isLTP: true,
            title: `LTP ₹${ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          },
        ]
      : [
          {
            value: ltp.toFixed(2),
            kind: "ltp",
            fw: 700,
            c: isITM ? (type === "CE" ? "green.8" : "red.8") : undefined,
            isLTP: true,
            title: `LTP ₹${ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          },
          { value: iv.toFixed(1), kind: "iv", c: "dimmed", title: `IV ${iv.toFixed(2)}%` },
          { value: formatNumber(volume), kind: "volume", isVol: true, title: `Volume ${volume.toLocaleString("en-IN")}` },
          {
            value: oiChangeText,
            kind: "change",
            c: getPnLTextColor(oiChange),
            badge: sentiment.label !== "Neutral" ? sentiment : undefined,
            positive: oiChange >= 0,
            title: `OI change ${oiChange.toLocaleString("en-IN")} (${oiChangePct.toFixed(2)}%)`,
          },
          { value: formatNumber(oi), kind: "oi", isOI: true, title: `OI ${oi.toLocaleString("en-IN")}` },
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

  const oiBarPct = clamp((oi / Math.max(maxOI, 1)) * 100, 0, 100);
  const volBarPct = clamp((volume / Math.max(maxVolume, 1)) * 100, 0, 100);

  const sideIntensity = clamp(
    0.14 + atmProximity * 0.22 + (isATM ? 0.08 : 0) + (isHovered ? 0.06 : 0),
    0.12,
    0.42,
  );
  const volumeIntensity = maxVolume > 0 ? clamp(volume / maxVolume, 0, 1) : 0;

  const tooltipContent = (
    <Box p="xs">
      <Group justify="space-between" mb={5}>
        <Text size="sm" fw={700} c={type === "CE" ? "green" : "red"}>
          {contract.trading_symbol}
        </Text>
        <Badge size="sm" color={sentiment.color} variant="filled">
          {sentiment.type}
        </Badge>
      </Group>
      <Text size="sm">
        OI: {oi.toLocaleString()} ({oiChange >= 0 ? "+" : ""}
        {oiChange.toLocaleString()})
      </Text>
      <Text size="sm" c={getPnLTextColor(oiChange)}>
        OI Change %: {oiChangePct.toFixed(2)}%
      </Text>
        <Box mt={5} pt={5}>
        <Text size="sm">Delta: {delta.toFixed(3)}</Text>
        <Text size="sm">Theta: {(g?.theta ?? 0).toFixed(2)}</Text>
        <Text size="sm">Gamma: {(g?.gamma ?? 0).toFixed(5)}</Text>
        <Text size="sm">Vega: {(g?.vega ?? 0).toFixed(2)}</Text>
        <Text size="sm">IV: {iv.toFixed(2)}%</Text>
      </Box>
      <Box mt={5} pt={5}>
        <Text size="sm">
          Bid: {m?.bid_price} | Ask: {m?.ask_price}
        </Text>
      </Box>
    </Box>
  );

  return (
    <Tooltip.Group openDelay={300}>
      {cellMeta.map((cell, i) => {
        const kindIntensity =
          cell.kind === "oi"
            ? clamp((oi / Math.max(maxOI, 1)) * 1.1 + sideIntensity, 0.12, 1)
            : cell.kind === "change"
              ? clamp(Math.abs(oiChangePct) / 35 + sideIntensity * 0.7, 0.12, 1)
              : cell.kind === "volume"
                ? clamp(volumeIntensity * 0.9 + 0.12, 0.1, 1)
                : cell.kind === "iv"
                  ? clamp((iv / 100) * 0.9 + 0.14, 0.1, 1)
                  : clamp(Math.abs(delta) * 0.9 + 0.16, 0.1, 1);
        const palette = getCellPalette(
          theme,
          cell.kind,
          type,
          kindIntensity,
          isHovered,
          isATM,
          isITM,
          cell.positive,
        );

        const cellStyle: CSSProperties = {
          ...styles.cell,
          position: "relative",
          fontWeight: cell.fw,
          background: palette.background,
          boxShadow: palette.shadow,
          color: cell.c ? undefined : palette.text,
        };

        return (
          <Tooltip
            key={i}
            label={tooltipContent}
            position="top"
            withArrow
            withinPortal
            multiline
            w={220}
          >
            <Box sx={cellStyle} title={cell.title} onClick={() => onRowClick(contract)}>
              {cell.isOI && (
                <Box
                  data-testid={`options-oi-bar-${type}-${rowStrike}`}
                  title={`OI ${oiBarPct.toFixed(0)}% of column max`}
                  sx={{
                    position: "absolute",
                    top: 4,
                    bottom: 4,
                    [type === "CE" ? "right" : "left"]: 0,
                    width: `${oiBarPct}%`,
                    background: `linear-gradient(180deg, ${hexToRgba(palette.accent, 0.22)} 0%, ${hexToRgba(palette.accent, 0.08)} 100%)`,
                    borderRadius: type === "CE" ? "999px 0 0 999px" : "0 999px 999px 0",
                    zIndex: 0,
                    transition: "width 0.35s ease",
                  }}
                />
              )}

              {cell.isVol && (
                <Box
                  data-testid={`options-vol-bar-${type}-${rowStrike}`}
                  title={`Volume ${volBarPct.toFixed(0)}% of column max`}
                  sx={{
                    position: "absolute",
                    top: 4,
                    bottom: 4,
                    [type === "CE" ? "right" : "left"]: 0,
                    width: `${volBarPct}%`,
                    background: `linear-gradient(180deg, ${hexToRgba(palette.accent, 0.22)} 0%, ${hexToRgba(palette.accent, 0.08)} 100%)`,
                    borderRadius: type === "CE" ? "999px 0 0 999px" : "0 999px 999px 0",
                    zIndex: 0,
                    transition: "width 0.35s ease",
                  }}
                />
              )}

              <Stack gap={0} align="center" w="100%" pos="relative" sx={{ zIndex: 1 }}>
                <Group gap={4} wrap="nowrap" align="center" justify="center">
                  <Text size="sm" fw={cell.fw} c={cell.c as any} ta="center" lh={1.05} className={flashClassFor(cell.kind)}>
                    {cell.value}
                  </Text>
                  {cell.badge && (
                    <Badge
                      size="sm"
                      variant="light"
                      color={cell.badge.color}
                      px={4}
                      sx={{
                        fontSize: "10px",
                        height: 14,
                      }}
                    >
                      {cell.badge.label}
                    </Badge>
                  )}
                </Group>

                {cell.isLTP && (
                  <Box w="72%" mt={3}>
                    <Progress
                      value={clamp(Math.abs(delta) * 100, 0, 100)}
                      size="sm"
                      color={type === "CE" ? "teal" : "orange"}
                      radius="xl"
                      styles={{
                        root: { backgroundColor: hexToRgba(palette.accent, 0.08), height: 3 },
                        bar: {
                          backgroundImage: `linear-gradient(90deg, ${hexToRgba(palette.accent, 0.85)} 0%, ${hexToRgba(palette.accent, 0.45)} 100%)`,
                        },
                      }}
                    />
                  </Box>
                )}
              </Stack>
            </Box>
          </Tooltip>
        );
      })}
    </Tooltip.Group>
  );
}

function OptionChainTableInner({
  strikeMatrix,
  filters: _filters,
  spotPrice,
  onRowClick,
  selectedExpiry,
}: OptionChainTableProps) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const styles = getStyles(theme, colorScheme === "dark");

  const viewportRef = useRef<HTMLDivElement>(null);
  const atmRowRef = useRef<HTMLDivElement>(null);
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  // ATM-first: default to a ±10 strike window so users land near the money
  // instead of scrolling from far-OTM strikes.
  const [atmWindow, setAtmWindow] = useState<AtmWindow>("10");

  // ATM strike = closest strike to spot (not a fixed ±25pt band, which breaks
  // on non-50pt step underlyings).
  const atmIndex = useMemo(
    () => findAtmIndex(strikeMatrix.map((s) => s.strike), spotPrice),
    [strikeMatrix, spotPrice],
  );
  // Strike-set identity: changes on expiry switch but not on OI/LTP ticks, so
  // auto-scroll fires on load/expiry change without yanking the user on every tick.
  const strikeKey = useMemo(() => strikeMatrix.map((s) => s.strike).join(","), [strikeMatrix]);

  const visibleRows = useMemo(() => {
    if (atmWindow === "all" || atmIndex < 0) {
      return strikeMatrix.map((row, index) => ({ ...row, index }));
    }
    const half = Number(atmWindow);
    return strikeMatrix
      .map((row, index) => ({ ...row, index }))
      .filter((row) => Math.abs(row.index - atmIndex) <= half);
  }, [strikeMatrix, atmIndex, atmWindow]);

  // In-cell bar widths are % of the *visible* column max, so the longest bar
  // always fills the cell within the current ATM window.
  const maxCE_OI = Math.max(...visibleRows.map((s) => s.ce?.market_data?.oi ?? 0), 1);
  const maxPE_OI = Math.max(...visibleRows.map((s) => s.pe?.market_data?.oi ?? 0), 1);
  const maxCE_Volume = Math.max(...visibleRows.map((s) => s.ce?.market_data?.volume ?? 0), 1);
  const maxPE_Volume = Math.max(...visibleRows.map((s) => s.pe?.market_data?.volume ?? 0), 1);

  const scrollToATM = (behavior: ScrollBehavior = "smooth") => {
    const atmRow = atmRowRef.current;
    if (!atmRow) return;
    // Contained: scroll the table viewport only. Native scrollIntoView would
    // escape to the page scroller (AppLayout shell) and bury the toolbar.
    if (viewportRef.current) {
      const viewport = viewportRef.current;
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
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: direction === "top" ? 0 : viewportRef.current.scrollHeight,
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
      sx={{ ...styles.container, position: "relative" }}
      data-testid="options-chain-table"
    >
      <ChainScrollActions scrollToATM={scrollToATM} scrollToEdge={scrollToEdge} />

      <Box sx={styles.windowBar}>
        <Text size="sm" c="dimmed" fw={600}>
          ATM window
        </Text>
        <SegmentedControl
          size="xs"
          value={atmWindow}
          onChange={(v) => setAtmWindow(v as AtmWindow)}
          data={ATM_WINDOW_OPTIONS}
          data-testid="options-chain-atm-window"
        />
        <Text size="sm" c="dimmed" data-testid="options-chain-window-count">
          Showing {visibleRows.length} of {strikeMatrix.length} strikes
        </Text>
      </Box>

      <ChainTableHeader theme={theme} styles={styles} />
      <ChainSubHeader styles={styles} />

      <ScrollArea
       
        flex={1}
        type="hover"
        scrollbars="y"
        viewportRef={viewportRef}
        data-testid="options-chain-table-scrollarea"
      >
        <Box sx={{ minWidth: 800, pb: 19 }}>
          {visibleRows.map(({ strike, ce, pe, index }) => {
            const isATM = index === atmIndex && atmIndex >= 0;
            const isHovered = hoveredStrike === strike;
            const isZebra = index % 2 === 1 && !isATM;
            // ITM zones: calls are ITM below spot (left side), puts ITM above
            // spot (right side). ATM keeps its warning outline as the
            // strongest signal on screen.
            const ceITM = spotPrice != null && strike < spotPrice;
            const peITM = spotPrice != null && strike > spotPrice;
            const proximity = spotPrice
              ? clamp(1 - Math.min(Math.abs(strike - spotPrice) / 220, 1), 0, 1)
              : 0;
            const rowCallBg = hexToRgba(
              theme.palette.success.main,
              0.04 + proximity * 0.09 + (isHovered ? 0.05 : 0) + (ceITM ? 0.08 : 0),
            );
            const rowPutBg = hexToRgba(
              theme.palette.error.main,
              0.04 + proximity * 0.09 + (isHovered ? 0.05 : 0) + (peITM ? 0.08 : 0),
            );
            // Per-row CE-vs-PE buildup skew: share of total strike OI held by calls.
            const ceRowOI = ce?.market_data?.oi ?? 0;
            const peRowOI = pe?.market_data?.oi ?? 0;
            const rowOITotal = ceRowOI + peRowOI;
            const ceSharePct = rowOITotal > 0 ? (ceRowOI / rowOITotal) * 100 : 50;

            return (
              <Box
                key={strike}
                ref={isATM ? atmRowRef : null}
                className={isATM ? "chain-row-atm" : undefined}
                data-atm={isATM ? "true" : undefined}
                data-ce-itm={ceITM ? "true" : undefined}
                data-pe-itm={peITM ? "true" : undefined}
                sx={{
                  ...styles.row,
                  ...(isZebra ? styles.zebraRow : {}),
                  ...(isATM ? styles.atmRow : {}),
                  background: `linear-gradient(90deg, ${rowCallBg} 0%, transparent 37%, ${isATM ? hexToRgba(theme.palette.warning.light, 0.12 + proximity * 0.12) : "transparent"} 50%, transparent 63%, ${rowPutBg} 100%)`,
                  boxShadow: isHovered
                    ? `inset 0 0 0 1px ${hexToRgba(theme.palette.warning.light, 0.5)}, 0 6px 16px ${hexToRgba(theme.palette.common.black, 0.08)}`
                    : undefined,
                }}
                data-testid={`options-chain-row-${strike}`}
                onMouseEnter={() => setHoveredStrike(strike)}
                onMouseLeave={() =>
                  setHoveredStrike((current) => (current === strike ? null : current))
                }
              >
                <OptionColumn
                  contract={ce}
                  type="CE"
                  spotPrice={spotPrice}
                  maxOI={maxCE_OI}
                  maxVolume={maxCE_Volume}
                  onRowClick={onRowClick}
                  theme={theme}
                  isHovered={isHovered}
                  rowStrike={strike}
                />

                <Box
                  sx={{
                    ...styles.strikeCell,
                    ...(isATM ? styles.atmHighlight : {}),
                    boxShadow: isHovered
                      ? `inset 0 0 0 1px ${hexToRgba(theme.palette.warning.main, 0.45)}, 0 8px 22px ${hexToRgba(theme.palette.common.black, 0.08)}`
                      : undefined,
                  }}
                  data-testid="strike-cell"
                >
                  <Text size="sm" fw={800}>
                    {strike}
                  </Text>
                  {isATM && (
                    <Badge
                      size="sm"
                      variant="filled"
                      color="warning"
                      data-testid="options-chain-atm-badge"
                    >
                      ATM
                    </Badge>
                  )}
                  {/* CE-vs-PE dominance micro-bar: green/red split of strike OI */}
                  <Box
                    data-testid={`options-dominance-${strike}`}
                    title={`CE ${ceSharePct.toFixed(0)}% / PE ${(100 - ceSharePct).toFixed(0)}% of strike OI`}
                    sx={{
                      display: "flex",
                      width: "100%",
                      height: 4,
                      borderRadius: 4,
                      overflow: "hidden",
                      mt: 4,
                      bgcolor: "divider",
                    }}
                  >
                    <Box sx={{ width: `${ceSharePct}%`, bgcolor: "success.main" }} />
                    <Box sx={{ width: `${100 - ceSharePct}%`, bgcolor: "error.main" }} />
                  </Box>
                </Box>

                <OptionColumn
                  contract={pe}
                  type="PE"
                  spotPrice={spotPrice}
                  maxOI={maxPE_OI}
                  maxVolume={maxPE_Volume}
                  onRowClick={onRowClick}
                  theme={theme}
                  isHovered={isHovered}
                  rowStrike={strike}
                />
              </Box>
            );
          })}
        </Box>
      </ScrollArea>

      <ChainFooter theme={theme} colorScheme={colorScheme} spotPrice={spotPrice} />
    </Box>
  );
}

export const OptionChainTable = memo(OptionChainTableInner);
