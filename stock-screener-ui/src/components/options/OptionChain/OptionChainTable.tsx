import {
  Box,
  Text,
  Tooltip,
  Group,
  Badge,
  ScrollArea,
  Progress,
  Stack,
  useColorScheme,
  useTheme,
} from "@/ui";
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { getMoneyness } from "../../../utils/options";
import { clamp, formatNumber, getPnLTextColor } from "../../../utils/ui-helpers";
import type { OptionContract } from "../../../api/upstoxOptions";
import { hexToRgba, getCellPalette, type CellKind } from "./cellPalette";
import { getStyles } from "./chainStyles";
import { ChainTableHeader } from "./ChainTableHeader";
import { ChainSubHeader } from "./ChainSubHeader";
import { ChainFooter } from "./ChainFooter";
import { ChainScrollActions } from "./ChainScrollActions";

interface OptionChainTableProps {
  strikeMatrix: Array<{ strike: number; ce: OptionContract | null; pe: OptionContract | null }>;
  filters: any;
  spotPrice: number | null;
  onRowClick: (contract: OptionContract) => void;
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
}: {
  contract: OptionContract | null;
  type: "CE" | "PE";
  spotPrice: number | null;
  maxOI: number;
  maxVolume: number;
  onRowClick: (c: OptionContract) => void;
  theme: ReturnType<typeof useTheme>;
  isHovered: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const styles = getStyles(theme, colorScheme === "dark");
  if (!contract) {
    return (
      <Box style={{ display: "contents" }}>
        {Array(5)
          .fill(0)
          .map((_, i) => (
            <Box key={i} style={styles.cell}>
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
  const volume = m?.volume ?? 0;
  const ltp = m?.ltp ?? 0;
  const iv = g?.iv ?? 0;
  const delta = g?.delta ?? 0;

  const sentiment = contract.sentiment || { type: "Neutral", color: "gray", label: "Neutral" };
  const cellMeta = (
    type === "CE"
      ? [
          { value: formatNumber(oi), kind: "oi", isOI: true },
          {
            value: formatNumber(oiChange),
            kind: "change",
            c: getPnLTextColor(oiChange),
            badge: sentiment.label !== "Neutral" ? sentiment : undefined,
            positive: oiChange >= 0,
          },
          { value: formatNumber(volume), kind: "volume" },
          { value: iv.toFixed(1), kind: "iv", c: "dimmed" },
          {
            value: ltp.toFixed(2),
            kind: "ltp",
            fw: 700,
            c: isITM ? (type === "CE" ? "green.8" : "red.8") : undefined,
            isLTP: true,
          },
        ]
      : [
          {
            value: ltp.toFixed(2),
            kind: "ltp",
            fw: 700,
            c: isITM ? (type === "CE" ? "green.8" : "red.8") : undefined,
            isLTP: true,
          },
          { value: iv.toFixed(1), kind: "iv", c: "dimmed" },
          { value: formatNumber(volume), kind: "volume" },
          {
            value: formatNumber(oiChange),
            kind: "change",
            c: getPnLTextColor(oiChange),
            badge: sentiment.label !== "Neutral" ? sentiment : undefined,
            positive: oiChange >= 0,
          },
          { value: formatNumber(oi), kind: "oi", isOI: true },
        ]
  ) as Array<{
    value: string;
    kind: CellKind;
    c?: string;
    badge?: { type: string; color: string; label: string };
    isOI?: boolean;
    isLTP?: boolean;
    fw?: number;
    positive?: boolean;
  }>;

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
      <Box
        mt={5}
        sx={{
          borderTop: 1,
          borderColor: "divider",
        }}
        pt={5}
      >
        <Text size="sm">Delta: {delta.toFixed(3)}</Text>
        <Text size="sm">Theta: {(g?.theta ?? 0).toFixed(2)}</Text>
        <Text size="sm">Gamma: {(g?.gamma ?? 0).toFixed(5)}</Text>
        <Text size="sm">Vega: {(g?.vega ?? 0).toFixed(2)}</Text>
        <Text size="sm">IV: {iv.toFixed(2)}%</Text>
      </Box>
      <Box
        mt={5}
        sx={{
          borderTop: 1,
          borderColor: "divider",
        }}
        pt={5}
      >
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
          borderRight: i < 4 && type === "CE" ? `1px solid ${palette.border}` : undefined,
          borderLeft: i > 0 && type === "PE" ? `1px solid ${palette.border}` : undefined,
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
            <Box style={cellStyle} onClick={() => onRowClick(contract)}>
              {cell.isOI && (
                <Box
                  style={{
                    position: "absolute",
                    top: 4,
                    bottom: 4,
                    [type === "CE" ? "right" : "left"]: 0,
                    width: `${clamp((oi / Math.max(maxOI, 1)) * 100, 0, 100)}%`,
                    background: `linear-gradient(180deg, ${hexToRgba(palette.accent, 0.22)} 0%, ${hexToRgba(palette.accent, 0.08)} 100%)`,
                    borderRadius: type === "CE" ? "999px 0 0 999px" : "0 999px 999px 0",
                    zIndex: 0,
                    transition: "width 0.35s ease",
                  }}
                />
              )}

              <Stack gap={0} align="center" w="100%" pos="relative" style={{ zIndex: 1 }}>
                <Group gap={4} wrap="nowrap" align="center" justify="center">
                  <Text size="sm" fw={cell.fw} c={cell.c as any} ta="center" lh={1.05}>
                    {cell.value}
                  </Text>
                  {cell.badge && (
                    <Badge
                      size="sm"
                      variant="light"
                      color={cell.badge.color}
                      px={4}
                      style={{
                        fontSize: "10px",
                        height: 14,
                        border: `1px solid ${hexToRgba(palette.accent, 0.18)}`,
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
}: OptionChainTableProps) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const styles = getStyles(theme, colorScheme === "dark");
  const maxCE_OI = Math.max(...strikeMatrix.map((s) => s.ce?.market_data?.oi ?? 0), 1);
  const maxPE_OI = Math.max(...strikeMatrix.map((s) => s.pe?.market_data?.oi ?? 0), 1);
  const maxCE_Volume = Math.max(...strikeMatrix.map((s) => s.ce?.market_data?.volume ?? 0), 1);
  const maxPE_Volume = Math.max(...strikeMatrix.map((s) => s.pe?.market_data?.volume ?? 0), 1);

  const viewportRef = useRef<HTMLDivElement>(null);
  const atmRowRef = useRef<HTMLDivElement>(null);
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);

  const scrollToATM = (behavior: ScrollBehavior = "smooth") => {
    if (atmRowRef.current && viewportRef.current) {
      const viewport = viewportRef.current;
      const atmRow = atmRowRef.current;
      const viewportHeight = viewport.clientHeight;
      const rowTop = atmRow.offsetTop;
      const rowHeight = atmRow.clientHeight;
      const scrollTo = rowTop - viewportHeight / 2 + rowHeight / 2;
      viewport.scrollTo({ top: Math.max(0, scrollTo), behavior });
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

  useEffect(() => {
    const timer = setTimeout(() => scrollToATM("auto"), 200);
    return () => clearTimeout(timer);
  }, [spotPrice, strikeMatrix.length]);

  return (
    <Box
      id="option-chain-table"
      className="option-chain-table"
      style={{ ...styles.container, position: "relative" }}
      data-testid="options-chain-table"
    >
      <ChainScrollActions scrollToATM={scrollToATM} scrollToEdge={scrollToEdge} />

      <ChainTableHeader theme={theme} styles={styles} />
      <ChainSubHeader styles={styles} />

      <ScrollArea
        className="chain-table-scrollarea"
        flex={1}
        type="hover"
        scrollbars="y"
        viewportRef={viewportRef}
        data-testid="options-chain-table-scrollarea"
      >
        <Box className="chain-table-body" miw={800} pb={150}>
          {strikeMatrix.map(({ strike, ce, pe }) => {
            const isATM = spotPrice && Math.abs(strike - spotPrice) < 25;
            const isHovered = hoveredStrike === strike;
            const proximity = spotPrice
              ? clamp(1 - Math.min(Math.abs(strike - spotPrice) / 220, 1), 0, 1)
              : 0;
            const rowCallBg = hexToRgba(
              theme.colors.green[6],
              0.04 + proximity * 0.09 + (isHovered ? 0.05 : 0),
            );
            const rowPutBg = hexToRgba(
              theme.colors.red[6],
              0.04 + proximity * 0.09 + (isHovered ? 0.05 : 0),
            );

            return (
              <Box
                key={strike}
                ref={isATM ? atmRowRef : null}
                className={`chain-row ${isATM ? "chain-row-atm" : ""}`}
                style={{
                  ...styles.row,
                  background: `linear-gradient(90deg, ${rowCallBg} 0%, transparent 37%, ${isATM ? hexToRgba(theme.colors.yellow[4], 0.12 + proximity * 0.12) : "transparent"} 50%, transparent 63%, ${rowPutBg} 100%)`,
                  boxShadow: isHovered
                    ? `inset 0 0 0 1px ${hexToRgba(theme.colors.yellow[4], 0.5)}, 0 6px 16px ${hexToRgba(theme.black, 0.08)}`
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
                />

                <Box
                  className={`strike-cell ${isATM ? "strike-cell-atm" : ""}`}
                  style={{
                    ...styles.strikeCell,
                    ...(isATM ? styles.atmHighlight : {}),
                    boxShadow: isHovered
                      ? `inset 0 0 0 1px ${hexToRgba(theme.colors.yellow[5], 0.45)}, 0 8px 22px ${hexToRgba(theme.black, 0.08)}`
                      : undefined,
                  }}
                  data-testid="strike-cell"
                >
                  <Text size="sm" fw={800}>
                    {strike}
                  </Text>
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
