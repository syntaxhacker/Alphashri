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
  useMantineTheme,
} from "@mantine/core";
import { memo, useEffect, useRef } from "react";
import { IconTarget, IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import { theme, fontWeights } from "../../../theme";
import { getMoneyness } from "../../../utils/options";
import type { OptionContract } from "../../../api/upstoxOptions";

interface OptionChainTableProps {
  strikeMatrix: Array<{ strike: number; ce: OptionContract | null; pe: OptionContract | null }>;
  filters: any;
  spotPrice: number | null;
  onRowClick: (contract: OptionContract) => void;
}

// Format with K/L/Cr suffix (Indian style)
function formatCompact(num: number): string {
  if (num === 0) return "0";
  const absNum = Math.abs(num);
  let result = "";

  if (absNum >= 10000000) result = (absNum / 10000000).toFixed(1) + "Cr";
  else if (absNum >= 100000) result = (absNum / 100000).toFixed(1) + "L";
  else if (absNum >= 1000) result = (absNum / 1000).toFixed(1) + "K";
  else result = absNum.toString();

  return num < 0 ? `-${result}` : result;
}

function getOIBgColor(oi: number, maxOI: number, type: "CE" | "PE"): string {
  if (maxOI === 0 || oi === 0) return "transparent";
  const ratio = oi / maxOI;
  const intensity = Math.min(ratio * 1.5, 1);
  return type === "CE"
    ? `rgba(64, 192, 87, ${intensity * 0.2})`
    : `rgba(250, 82, 82, ${intensity * 0.2})`;
}

const getStyles = (theme: { fontSizes: { sm: string; md: string } }) => ({
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 320px)",
    minHeight: 400,
    overflow: "hidden",
    border: "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
    borderRadius: "var(--mantine-radius-md)",
    background: "light-dark(var(--mantine-color-white), var(--mantine-color-dark-7))",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    background: "light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-8))",
    borderBottom: "2px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
  },
  headerCell: {
    padding: "10px 4px",
    textAlign: "center" as const,
    fontWeight: fontWeights.bold,
    fontSize: theme.fontSizes.md,
    letterSpacing: "0.5px",
    color: "light-dark(var(--mantine-color-black), var(--mantine-color-dark-0))",
  },
  subHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    background: "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))",
    borderBottom: "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
    position: "sticky" as const,
    top: 40,
    zIndex: 9,
  },
  subHeaderCell: {
    padding: "4px 2px",
    textAlign: "center" as const,
    fontSize: theme.fontSizes.sm,
    color: "var(--mantine-color-dimmed)",
    fontWeight: fontWeights.semibold,
    textTransform: "uppercase" as const,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr) 80px repeat(5, 1fr)",
    borderBottom: "1px solid light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-5))",
    transition: "background 0.15s",
  },
  cell: {
    padding: "8px 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: theme.fontSizes.sm,
    cursor: "pointer",
    minHeight: 40,
  },
  strikeCell: {
    padding: "4px 8px",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    background: "light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-8))",
    borderLeft: "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
    borderRight: "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
    position: "sticky" as const,
    left: "calc(50% - 40px)",
    zIndex: 2,
  },
  itmShade: {
    background: "light-dark(rgba(255, 249, 219, 0.4), rgba(255, 224, 102, 0.05))",
  },
  atmHighlight: {
    background: "light-dark(var(--mantine-color-yellow-1), var(--mantine-color-yellow-9))",
    color: "light-dark(var(--mantine-color-yellow-9), var(--mantine-color-white))",
  },
});

function OptionColumn({
  contract,
  type,
  spotPrice,
  maxOI,
  onRowClick,
  theme,
}: {
  contract: OptionContract | null;
  type: "CE" | "PE";
  spotPrice: number | null;
  maxOI: number;
  onRowClick: (c: OptionContract) => void;
  theme: { fontSizes: { sm: string; md: string } };
}) {
  const styles = getStyles(theme);
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

  const itmStyle = isITM ? styles.itmShade : {};

  // Calculate width for visual OI bar
  const oiBarWidth = maxOI > 0 ? (oi / maxOI) * 100 : 0;
  const oiBarColor = type === "CE" ? "rgba(64, 192, 87, 0.12)" : "rgba(250, 82, 82, 0.12)";

  const cells = [
    {
      value: formatCompact(oi),
      label: "OI",
      isOI: true,
    },
    {
      value: formatCompact(oiChange),
      label: "OI CHG",
      c: oiChange >= 0 ? "green" : "red",
      badge: sentiment.label !== "Neutral" ? sentiment : undefined,
    },
    { value: formatCompact(volume), label: "VOL" },
    { value: iv.toFixed(1), label: "IV", c: "dimmed" },
    {
      value: ltp.toFixed(2),
      label: "LTP",
      fw: 700,
      c: isITM ? (type === "CE" ? "green.8" : "red.8") : undefined,
      isLTP: true,
    },
  ];

  // For PE, the order is reversed in professional chains: LTP, IV, Vol, Chng, OI
  if (type === "PE") {
    cells.reverse();
  }

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
      <Box mt={5} style={{ borderTop: "1px solid #eee" }} pt={5}>
        <Text size="sm">Delta: {delta.toFixed(3)}</Text>
        <Text size="sm">Theta: {(g?.theta ?? 0).toFixed(2)}</Text>
        <Text size="sm">Gamma: {(g?.gamma ?? 0).toFixed(5)}</Text>
        <Text size="sm">Vega: {(g?.vega ?? 0).toFixed(2)}</Text>
        <Text size="sm">IV: {iv.toFixed(2)}%</Text>
      </Box>
      <Box mt={5} style={{ borderTop: "1px solid #eee" }} pt={5}>
        <Text size="sm">
          Bid: {m?.bid_price} | Ask: {m?.ask_price}
        </Text>
      </Box>
    </Box>
  );

  return (
    <Tooltip.Group openDelay={300}>
      {cells.map((cell: any, i) => (
        <Tooltip
          key={i}
          label={tooltipContent}
          position="top"
          withArrow
          withinPortal
          multiline
          w={220}
        >
          <Box
            style={{
              ...styles.cell,
              ...itmStyle,
              position: "relative",
              fontWeight: cell.fw,
              borderRight: i < 4 && type === "CE" ? "1px solid rgba(0,0,0,0.02)" : undefined,
              borderLeft: i > 0 && type === "PE" ? "1px solid rgba(0,0,0,0.02)" : undefined,
            }}
            onClick={() => onRowClick(contract)}
          >
            {/* Visual OI Bar */}
            {cell.isOI && (
              <Box
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  [type === "CE" ? "right" : "left"]: 0,
                  width: `${oiBarWidth}%`,
                  backgroundColor: oiBarColor,
                  zIndex: 0,
                  transition: "width 0.4s ease",
                }}
              />
            )}

            <Stack gap={0} align="center" style={{ zIndex: 1, width: "100%" }}>
              <Group gap={2} wrap="nowrap" align="center" justify="center">
                <Text size="sm" fw={cell.fw} c={cell.c as any} style={{ textAlign: "center" }}>
                  {cell.value}
                </Text>
                {cell.badge && (
                  <Badge
                    size="sm"
                    variant="light"
                    color={cell.badge.color}
                    px={2}
                    style={{ fontSize: theme.fontSizes.sm, height: 12 }}
                  >
                    {cell.badge.label}
                  </Badge>
                )}
              </Group>

              {/* Visual Delta Bar for LTP cell */}
              {cell.isLTP && (
                <Box w="70%" mt={2}>
                  <Progress
                    value={Math.abs(delta) * 100}
                    size="sm"
                    color={type === "CE" ? "green" : "red"}
                    radius="xl"
                    styles={{ root: { backgroundColor: "transparent", height: 2 } }}
                  />
                </Box>
              )}
            </Stack>
          </Box>
        </Tooltip>
      ))}
    </Tooltip.Group>
  );
}

function OptionChainTableInner({
  strikeMatrix,
  filters,
  spotPrice,
  onRowClick,
}: OptionChainTableProps) {
  const theme = useMantineTheme();
  const styles = getStyles(theme);
  const { optionType } = filters;
  const maxCE_OI = Math.max(...strikeMatrix.map((s) => s.ce?.market_data?.oi ?? 0), 1);
  const maxPE_OI = Math.max(...strikeMatrix.map((s) => s.pe?.market_data?.oi ?? 0), 1);

  const viewportRef = useRef<HTMLDivElement>(null);
  const atmRowRef = useRef<HTMLDivElement>(null);

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
      <Box className="chain-table-header" style={styles.header} data-testid="options-chain-table-header">
        <Box className="chain-header-cell chain-calls-header" style={{ ...styles.headerCell, color: "var(--mantine-color-green-6)" }}>
          CALLS (CE)
        </Box>
        <Box className="chain-header-cell chain-strike-header" style={styles.headerCell}>STRIKE</Box>
        <Box className="chain-header-cell chain-puts-header" style={{ ...styles.headerCell, color: "var(--mantine-color-red-6)" }}>PUTS (PE)</Box>
      </Box>

      {/* Symmetrical Sub-Header */}
      <Box className="chain-table-subheader" style={styles.subHeader} data-testid="options-chain-table-subheader">
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

            return (
              <Box
                key={strike}
                ref={isATM ? atmRowRef : null}
                className={`chain-row ${isATM ? 'chain-row-atm' : ''}`}
                style={styles.row}
                data-testid={`options-chain-row-${strike}`}
              >
                {/* CALLS */}
                <OptionColumn
                  contract={ce}
                  type="CE"
                  spotPrice={spotPrice}
                  maxOI={maxCE_OI}
                  onRowClick={onRowClick}
                  theme={theme}
                />

                {/* STRIKE */}
                <Box
                  className={`strike-cell ${isATM ? 'strike-cell-atm' : ''}`}
                  style={{ ...styles.strikeCell, ...(isATM ? styles.atmHighlight : {}) }}
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
                  onRowClick={onRowClick}
                  theme={theme}
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
          borderTop: "1px solid var(--mantine-color-gray-3)",
          background: "var(--mantine-color-gray-0)",
        }}
        data-testid="options-chain-table-footer"
      >
        <Group gap="xl" className="chain-legend">
          <Group gap={5} className="chain-legend-item" data-testid="options-legend-itm">
            <Box w={10} h={10} bg="rgba(255, 249, 219, 0.4)" style={{ border: "1px solid #ddd" }} />
            <Text size="sm" c="dimmed">
              ITM (In The Money)
            </Text>
          </Group>
          <Group gap={5} className="chain-legend-item" data-testid="options-legend-atm">
            <Box w={10} h={10} bg="var(--mantine-color-yellow-1)" />
            <Text size="sm" c="dimmed">
              ATM (At The Money)
            </Text>
          </Group>
          <Group gap={15} className="chain-legend-badges" data-testid="options-legend-badges">
            <Badge size="sm" variant="outline" color="green">
              LB: Long Buildup
            </Badge>
            <Badge size="sm" variant="outline" color="red">
              SB: Short Buildup
            </Badge>
            <Badge size="sm" variant="outline" color="cyan">
              SC: Short Covering
            </Badge>
            <Badge size="sm" variant="outline" color="orange">
              LU: Long Unwinding
            </Badge>
          </Group>
        </Group>
        {spotPrice && (
          <Text size="sm" fw={600} className="chain-spot-price" data-testid="options-chain-spot-price">
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
