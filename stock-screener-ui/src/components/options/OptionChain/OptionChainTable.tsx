import {
  Box,
  Text,
  Tooltip,
  Group,
  Badge,
  ScrollArea,
  Flex,
  Progress,
  Stack,
  ActionIcon,
  useMantineColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { IconTarget, IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import { fontWeights } from "../../../theme";
import { getMoneyness } from "../../../utils/options";
import { formatNumber } from "../../../utils/ui-helpers";
import type { OptionContract } from "../../../api/upstoxOptions";

interface OptionChainTableProps {
  strikeMatrix: Array<{ strike: number; ce: OptionContract | null; pe: OptionContract | null }>;
  filters: any;
  spotPrice: number | null;
  onRowClick: (contract: OptionContract) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;
  const int = Number.parseInt(value, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixColors(colorA: string, colorB: string, ratio: number): string {
  const normalizedRatio = clamp(ratio, 0, 1);
  const parse = (hex: string) => {
    const normalized = hex.replace("#", "");
    const value =
      normalized.length === 3
        ? normalized
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : normalized;
    const int = Number.parseInt(value, 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255,
    };
  };
  const ca = parse(colorA);
  const cb = parse(colorB);
  const r = Math.round(ca.r + (cb.r - ca.r) * normalizedRatio);
  const g = Math.round(ca.g + (cb.g - ca.g) * normalizedRatio);
  const blue = Math.round(ca.b + (cb.b - ca.b) * normalizedRatio);
  return `rgb(${r}, ${g}, ${blue})`;
}

type CellKind = "oi" | "change" | "volume" | "iv" | "ltp";

function getSidePalette(theme: ReturnType<typeof useMantineTheme>, type: "CE" | "PE") {
  const colors = theme.colors || {};
  const green = colors.green ||
    colors.gray || ["#000", "#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888", "#999"];
  const teal = colors.teal ||
    colors.cyan ||
    colors.green || [
      "#000",
      "#111",
      "#222",
      "#333",
      "#444",
      "#555",
      "#666",
      "#777",
      "#888",
      "#999",
    ];
  const lime = colors.lime ||
    colors.yellow ||
    colors.green || [
      "#000",
      "#111",
      "#222",
      "#333",
      "#444",
      "#555",
      "#666",
      "#777",
      "#888",
      "#999",
    ];
  const red = colors.red ||
    colors.pink || ["#000", "#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888", "#999"];
  const orange = colors.orange ||
    colors.yellow ||
    colors.red || ["#000", "#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888", "#999"];
  const pink = colors.pink ||
    colors.red || ["#000", "#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888", "#999"];

  return type === "CE"
    ? {
        main: green[6] ?? green[5],
        alt: teal[5] ?? teal[4],
        glow: lime[4] ?? lime[3],
        ink: green[8] ?? green[7],
      }
    : {
        main: red[6] ?? red[5],
        alt: orange[5] ?? orange[4],
        glow: pink[4] ?? pink[3],
        ink: red[8] ?? red[7],
      };
}

function getCellPalette(
  theme: ReturnType<typeof useMantineTheme>,
  kind: CellKind,
  type: "CE" | "PE",
  intensity: number,
  isHovered: boolean,
  isATM: boolean,
  isITM: boolean,
  isPositive?: boolean,
) {
  const side = getSidePalette(theme, type);
  const boost = isHovered ? 1.18 : 1;
  const atmBoost = isATM ? 1.12 : 1;
  const itmBoost = isITM ? 1.08 : 1;
  const baseIntensity = clamp(intensity * boost * atmBoost * itmBoost, 0, 1);
  const secondaryScale = clamp(baseIntensity * 0.7, 0, 1);

  let base = side.main;
  let alt = side.alt;
  let glow = side.glow;
  let text = side.ink;

  const colors = theme.colors || {};
  const getColor = (name: string, index: number): string => {
    const arr = colors[name] || colors.gray || [];
    return arr[index] || arr[0] || "#888";
  };

  if (kind === "change") {
    base = isPositive ? getColor("green", 6) : getColor("red", 6);
    alt = isPositive ? getColor("teal", 5) : getColor("orange", 5);
    glow = isPositive ? getColor("lime", 4) : getColor("pink", 4);
    text = isPositive ? getColor("green", 8) : getColor("red", 8);
  } else if (kind === "volume") {
    base = getColor("blue", 6);
    alt = getColor("cyan", 5);
    glow = getColor("indigo", 4);
    text = getColor("blue", 8);
  } else if (kind === "iv") {
    base = getColor("violet", 6);
    alt = getColor("grape", 5);
    glow = getColor("indigo", 4);
    text = getColor("violet", 8);
  } else if (kind === "ltp") {
    base = type === "CE" ? getColor("yellow", 6) : getColor("orange", 6);
    alt = type === "CE" ? getColor("amber", 5) : getColor("yellow", 5);
    glow = getColor("orange", 4);
    text = mixColors(getColor("gray", 9), base, 0.55);
  }

  const baseAlpha = 0.08 + baseIntensity * 0.26;
  const altAlpha = 0.04 + secondaryScale * 0.18;
  const borderAlpha = 0.18 + baseIntensity * 0.24;
  const shadowAlpha = 0.08 + baseIntensity * 0.16;

  return {
    background: `linear-gradient(135deg, ${hexToRgba(base, baseAlpha)} 0%, ${hexToRgba(alt, altAlpha)} 100%)`,
    border: hexToRgba(glow, borderAlpha),
    shadow: `inset 0 1px 0 ${hexToRgba(theme.white, 0.06)}, 0 0 0 1px ${hexToRgba(glow, shadowAlpha)}`,
    text,
    accent: glow,
  };
}

const getStyles = (theme: ReturnType<typeof useMantineTheme>, isDark: boolean) => ({
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 300px)",
    minHeight: 400,
    overflow: "hidden",
    border: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    borderRadius: "var(--mantine-radius-lg)",
    background:
      "linear-gradient(180deg, light-dark(rgba(255,255,255,0.96), rgba(15,23,42,0.94)) 0%, light-dark(rgba(248,250,252,0.88), rgba(11,15,20,0.9)) 100%)",
    boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    background:
      "linear-gradient(135deg, light-dark(rgba(240,253,250,0.96), rgba(12,22,20,0.96)) 0%, light-dark(rgba(255,255,255,0.96), rgba(17,24,39,0.95)) 50%, light-dark(rgba(255,240,245,0.96), rgba(24,13,18,0.96)) 100%)",
    borderBottom: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.75)}`,
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
  },
  headerCell: {
    padding: "10px 8px",
    textAlign: "center" as const,
    fontWeight: fontWeights.bold,
    fontSize: theme.fontSizes.md,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "light-dark(var(--mantine-color-gray-8), var(--mantine-color-dark-0))",
  },
  subHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    background:
      "linear-gradient(90deg, light-dark(rgba(236,253,245,0.92), rgba(12,18,16,0.92)) 0%, light-dark(rgba(248,250,252,0.95), rgba(15,23,42,0.88)) 50%, light-dark(rgba(254,242,242,0.92), rgba(24,12,16,0.92)) 100%)",
    borderBottom: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.7)}`,
    position: "sticky" as const,
    top: 40,
    zIndex: 9,
  },
  subHeaderCell: {
    padding: "5px 2px",
    textAlign: "center" as const,
    fontSize: "11px",
    color: "var(--mantine-color-dimmed)",
    fontWeight: fontWeights.semibold,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    borderBottom: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 5 : 2], 0.65)}`,
    transition: "background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
    position: "relative" as const,
    background:
      "linear-gradient(90deg, transparent 0%, light-dark(rgba(255,255,255,0.12), rgba(255,255,255,0.03)) 50%, transparent 100%)",
  },
  cell: {
    padding: "6px 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: theme.fontSizes.sm,
    cursor: "pointer",
    minHeight: 42,
    position: "relative" as const,
    overflow: "hidden",
  },
  strikeCell: {
    padding: "4px 8px",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    background:
      "linear-gradient(180deg, light-dark(rgba(255,255,255,0.96), rgba(15,23,42,0.92)) 0%, light-dark(rgba(245,247,250,0.95), rgba(11,15,20,0.95)) 100%)",
    borderLeft: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    borderRight: `1px solid ${hexToRgba(theme.colors.gray[isDark ? 4 : 3], 0.8)}`,
    position: "sticky" as const,
    left: "calc(50% - 40px)",
    zIndex: 2,
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
  },
  atmHighlight: {
    background:
      "linear-gradient(180deg, light-dark(rgba(254,240,138,0.96), rgba(133,77,14,0.52)) 0%, light-dark(rgba(253,224,71,0.9), rgba(120,53,15,0.42)) 100%)",
    color: "light-dark(var(--mantine-color-yellow-9), var(--mantine-color-yellow-0))",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
  },
});

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
  theme: ReturnType<typeof useMantineTheme>;
  isHovered: boolean;
}) {
  const { colorScheme } = useMantineColorScheme();
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

  // Use backend sentiment
  const sentiment = contract.sentiment || { type: "Neutral", color: "gray", label: "Neutral" };
  const cellMeta = (
    type === "CE"
      ? [
          { value: formatNumber(oi), kind: "oi", isOI: true },
          {
            value: formatNumber(oiChange),
            kind: "change",
            c: oiChange >= 0 ? "green" : "red",
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
            c: oiChange >= 0 ? "green" : "red",
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
      <Text size="sm" c={oiChange >= 0 ? "green" : "red"}>
        OI Change %: {oiChangePct.toFixed(2)}%
      </Text>
      <Box
        mt={5}
        style={{
          borderTop:
            "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
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
        style={{
          borderTop:
            "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
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
              {/* Visual OI Bar */}
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

              <Stack
                gap={0}
                align="center"
                style={{ zIndex: 1, width: "100%", position: "relative" }}
              >
                <Group gap={4} wrap="nowrap" align="center" justify="center">
                  <Text
                    size="sm"
                    fw={cell.fw}
                    c={cell.c as any}
                    style={{ textAlign: "center", lineHeight: 1.05 }}
                  >
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

                {/* Visual Delta Bar for LTP cell */}
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
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
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

  // Auto-scroll to ATM when data loads
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
      {/* Quick Scroll Actions */}
      <Box
        className="chain-scroll-actions"
        style={{
          position: "absolute",
          right: 20,
          bottom: 80,
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
        data-testid="options-chain-scroll-actions"
      >
        <Tooltip label="Scroll to Top" position="left">
          <ActionIcon
            variant="light"
            color="gray"
            size="lg"
            radius="xl"
            onClick={() => scrollToEdge("top")}
            className="scroll-action-btn"
            data-testid="options-scroll-top-btn"
          >
            <IconArrowUp size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Jump to ATM" position="left">
          <ActionIcon
            variant="filled"
            color="yellow"
            size="xl"
            radius="xl"
            onClick={() => scrollToATM("smooth")}
            style={{ boxShadow: "var(--mantine-shadow-md)" }}
            className="scroll-action-btn scroll-atm-btn"
            data-testid="options-scroll-atm-btn"
          >
            <IconTarget size={22} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Scroll to Bottom" position="left">
          <ActionIcon
            variant="light"
            color="gray"
            size="lg"
            radius="xl"
            onClick={() => scrollToEdge("bottom")}
            className="scroll-action-btn"
            data-testid="options-scroll-bottom-btn"
          >
            <IconArrowDown size={18} />
          </ActionIcon>
        </Tooltip>
      </Box>

      {/* Main Header */}
      <Box
        className="chain-table-header"
        style={styles.header}
        data-testid="options-chain-table-header"
      >
        <Box
          className="chain-header-cell chain-calls-header"
          style={{
            ...styles.headerCell,
            color: theme.colors.green[8],
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.14) 0%, rgba(20,184,166,0.12) 100%)",
          }}
        >
          CALLS (CE)
        </Box>
        <Box
          className="chain-header-cell chain-strike-header"
          style={{
            ...styles.headerCell,
            color: theme.colors.yellow[9],
            background:
              "linear-gradient(180deg, rgba(250,204,21,0.22) 0%, rgba(253,224,71,0.12) 100%)",
          }}
        >
          STRIKE
        </Box>
        <Box
          className="chain-header-cell chain-puts-header"
          style={{
            ...styles.headerCell,
            color: theme.colors.red[8],
            background:
              "linear-gradient(135deg, rgba(251,113,133,0.12) 0%, rgba(249,115,22,0.14) 100%)",
          }}
        >
          PUTS (PE)
        </Box>
      </Box>

      {/* Symmetrical Sub-Header */}
      <Box
        className="chain-table-subheader"
        style={styles.subHeader}
        data-testid="options-chain-table-subheader"
      >
        {/* CE columns: OI, CHNG, VOL, IV, LTP */}
        <Box style={styles.subHeaderCell}>OI</Box>
        <Box style={styles.subHeaderCell}>OI CHG</Box>
        <Box style={styles.subHeaderCell}>VOL</Box>
        <Box style={styles.subHeaderCell}>IV</Box>
        <Box style={styles.subHeaderCell}>LTP</Box>

        {/* Strike */}
        <Box style={styles.subHeaderCell}></Box>

        {/* PE columns: LTP, IV, VOL, CHNG, OI */}
        <Box style={styles.subHeaderCell}>LTP</Box>
        <Box style={styles.subHeaderCell}>IV</Box>
        <Box style={styles.subHeaderCell}>VOL</Box>
        <Box style={styles.subHeaderCell}>OI CHG</Box>
        <Box style={styles.subHeaderCell}>OI</Box>
      </Box>

      <ScrollArea
        className="chain-table-scrollarea"
        style={{ flex: 1 }}
        type="hover"
        scrollbars="y"
        viewportRef={viewportRef}
        data-testid="options-chain-table-scrollarea"
      >
        <Box className="chain-table-body" style={{ minWidth: 800, paddingBottom: 150 }}>
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
                {/* CALLS */}
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

                {/* STRIKE */}
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

                {/* PUTS */}
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

      {/* Footer / Legend */}
      <Flex
        className="chain-table-footer"
        p="xs"
        justify="space-between"
        align="center"
        style={{
          borderTop: `1px solid ${hexToRgba(theme.colors.gray[colorScheme === "dark" ? 4 : 3], 0.75)}`,
          background:
            "linear-gradient(90deg, light-dark(rgba(240,253,250,0.9), rgba(12,18,16,0.9)) 0%, light-dark(rgba(248,250,252,0.9), rgba(15,23,42,0.88)) 50%, light-dark(rgba(255,240,245,0.9), rgba(24,12,16,0.9)) 100%)",
        }}
        data-testid="options-chain-table-footer"
      >
        <Group gap="xl" className="chain-legend">
          <Group gap={5} className="chain-legend-item" data-testid="options-legend-itm">
            <Box
              w={10}
              h={10}
              style={{
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.45) 0%, rgba(34,197,94,0.28) 100%)",
                border: `1px solid ${hexToRgba(theme.colors.yellow[5], 0.4)}`,
              }}
            />
            <Text size="sm" c="dimmed">
              ITM (In The Money)
            </Text>
          </Group>
          <Group gap={5} className="chain-legend-item" data-testid="options-legend-atm">
            <Box
              w={10}
              h={10}
              style={{
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(253,224,71,0.95) 0%, rgba(251,191,36,0.65) 100%)",
              }}
            />
            <Text size="sm" c="dimmed">
              ATM (At The Money)
            </Text>
          </Group>
          <Group gap={15} className="chain-legend-badges" data-testid="options-legend-badges">
            <Badge size="sm" variant="light" color="green">
              LB: Long Buildup
            </Badge>
            <Badge size="sm" variant="light" color="red">
              SB: Short Buildup
            </Badge>
            <Badge size="sm" variant="light" color="cyan">
              SC: Short Covering
            </Badge>
            <Badge size="sm" variant="light" color="orange">
              LU: Long Unwinding
            </Badge>
          </Group>
        </Group>
        {spotPrice && (
          <Text
            size="sm"
            fw={600}
            className="chain-spot-price"
            data-testid="options-chain-spot-price"
          >
            Spot:{" "}
            <Text component="span" c="blue">
              {spotPrice.toFixed(2)}
            </Text>
          </Text>
        )}
      </Flex>
    </Box>
  );
}

export const OptionChainTable = memo(OptionChainTableInner);
