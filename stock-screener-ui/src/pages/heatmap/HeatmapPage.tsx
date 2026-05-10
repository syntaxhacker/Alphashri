import { useEffect, useState, useMemo } from "react";
import {
  Box,
  Flex,
  Text,
  Group,
  Select,
  TextInput,
  SegmentedControl,
  LoadingOverlay,
  Tooltip,
  Badge,
} from "@mantine/core";
import { useAsync } from "../../hooks/useAsync";
import { fetchHeatmapData, fetchHeatmapSectors, type HeatmapStock, type SectorInfo } from "../../api/heatmap";

const GRID_COLS = 10;

const PE_COLORS: Record<string, string> = {
  green: "#1a9850",
  "light-green": "#91cf60",
  yellow: "#ffffbf",
  orange: "#fc8d59",
  red: "#d73027",
  grey: "#808080",
};

function getPeColor(pe: number): string {
  if (pe < 10) return PE_COLORS.green;
  if (pe < 15) return PE_COLORS["light-green"];
  if (pe < 20) return PE_COLORS.yellow;
  if (pe < 30) return PE_COLORS.orange;
  return PE_COLORS.red;
}

function formatMarketCap(mcap: number): string {
  if (mcap >= 1e12) return `₹${(mcap / 1e12).toFixed(1)}T`;
  if (mcap >= 1e10) return `₹${(mcap / 1e10).toFixed(1)}L`;
  if (mcap >= 1e8) return `₹${(mcap / 1e8).toFixed(1)}Cr`;
  return `₹${(mcap / 1e6).toFixed(0)}M`;
}

export function HeatmapPage() {
  const [sortBy, setSortBy] = useState<"market_cap" | "pe_ratio">("market_cap");
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [view, setView] = useState("heatmap");

  const { data: heatmapData, loading: heatmapLoading, error: heatmapError, execute: loadHeatmap } = useAsync(
    () => fetchHeatmapData(undefined, undefined, sectorFilter || undefined, 500),
    { immediate: true }
  );

  const { data: sectorsData, loading: sectorsLoading } = useAsync(() => fetchHeatmapSectors(), {
    immediate: true,
  });

  const stocks = heatmapData?.stocks || [];

  const filteredStocks = useMemo(() => {
    let result = [...stocks];

    if (searchFilter) {
      const lower = searchFilter.toLowerCase();
      result = result.filter(
        (s) => s.symbol.toLowerCase().includes(lower) || s.name.toLowerCase().includes(lower)
      );
    }

    result.sort((a, b) => {
      if (sortBy === "market_cap") return b.market_cap - a.market_cap;
      return a.pe_ratio - b.pe_ratio;
    });

    return result;
  }, [stocks, searchFilter, sortBy]);

  const gridStocks = useMemo(() => {
    const rows: HeatmapStock[][] = [];
    for (let i = 0; i < filteredStocks.length; i += GRID_COLS) {
      rows.push(filteredStocks.slice(i, i + GRID_COLS));
    }
    return rows;
  }, [filteredStocks]);

  const sectorOptions = useMemo(() => {
    if (!sectorsData?.sectors) return [];
    return sectorsData.sectors.map((s: SectorInfo) => ({
      value: s.name,
      label: `${s.name} (${s.count})`,
    }));
  }, [sectorsData]);

  const totalCount = filteredStocks.length;
  const displayCount = Math.min(totalCount, 500);

  return (
    <Box style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box
        p="sm"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
        }}
      >
        <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
          <Group gap="xs">
            <Text fw={700} size="lg">
              🇮🇳 NSE 500 · P/E Forward
            </Text>
            <Badge variant="light" color={heatmapData?.cached ? "green" : "blue"}>
              {heatmapData?.cached ? "Cached" : "Live"}
            </Badge>
          </Group>

          <SegmentedControl
            size="xs"
            value={view}
            onChange={setView}
            data={[
              { label: "Heatmap", value: "heatmap" },
              { label: "Bars", value: "bars" },
              { label: "Table", value: "table" },
            ]}
          />
        </Flex>

        <Group mt="sm" gap="sm">
          <Select
            size="xs"
            placeholder="Filter by sector"
            clearable
            value={sectorFilter}
            onChange={setSectorFilter}
            data={sectorOptions}
            style={{ width: 200 }}
            searchable
          />
          <TextInput
            size="xs"
            placeholder="Search symbol or name..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            style={{ width: 180 }}
          />
          <Select
            size="xs"
            value={sortBy}
            onChange={(v) => setSortBy((v as "market_cap") || "market_cap")}
            data={[
              { value: "market_cap", label: "Sort by MCap" },
              { value: "pe_ratio", label: "Sort by P/E" },
            ]}
            style={{ width: 120 }}
          />
          <Text size="xs" c="dimmed">
            {displayCount} stocks
          </Text>
        </Group>
      </Box>

      <Box style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <LoadingOverlay visible={heatmapLoading} />

        {heatmapError && (
          <Flex justify="center" align="center" h={200}>
            <Text c="red">{heatmapError.message || "Failed to load heatmap data"}</Text>
          </Flex>
        )}

        {!heatmapLoading && view === "heatmap" && (
          <Box p="sm">
            <Box
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                gap: 2,
              }}
            >
              {gridStocks.map((row, rowIdx) =>
                row.map((stock, colIdx) => (
                  <Tooltip
                    key={`${stock.symbol}-${rowIdx}-${colIdx}`}
                    label={
                      <Box p="xs">
                        <Text fw={700} size="sm">
                          {stock.symbol}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {stock.name}
                        </Text>
                        <Text size="xs" mt={4}>
                          P/E: <b>{stock.pe_ratio}</b>
                        </Text>
                        <Text size="xs">
                          MCap: <b>{formatMarketCap(stock.market_cap)}</b>
                        </Text>
                        {stock.price && (
                          <Text size="xs">
                            Price: <b>₹{stock.price.toFixed(2)}</b>
                          </Text>
                        )}
                        {stock.change_pct !== undefined && (
                          <Text
                            size="xs"
                            c={stock.change_pct >= 0 ? "green" : "red"}
                          >
                            {stock.change_pct >= 0 ? "+" : ""}
                            {stock.change_pct.toFixed(2)}%
                          </Text>
                        )}
                        {stock.sector && (
                          <Badge size="xs" mt={4}>
                            {stock.sector}
                          </Badge>
                        )}
                      </Box>
                    }
                    position="top-start"
                    withArrow
                  >
                    <Box
                      style={{
                        aspectRatio: "1.4",
                        backgroundColor: getPeColor(stock.pe_ratio),
                        borderRadius: 4,
                        padding: 4,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        cursor: "pointer",
                        minHeight: 48,
                        transition: "transform 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "scale(1.05)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "scale(1)";
                      }}
                    >
                      <Text
                        size="xs"
                        fw={600}
                        c="dark"
                        style={{
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                          maxWidth: "100%",
                          lineHeight: 1.2,
                        }}
                      >
                        {stock.symbol}
                      </Text>
                      <Text
                        size="xs"
                        fw={700}
                        c="dark"
                        style={{ lineHeight: 1.2 }}
                      >
                        {stock.pe_ratio}
                      </Text>
                    </Box>
                  </Tooltip>
                ))
              )}
            </Box>
          </Box>
        )}

        {!heatmapLoading && view === "table" && (
          <Box p="sm">
            <Box
              style={{
                display: "table",
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <Box component="thead" style={{ display: "table-header-group" }}>
                <Box component="tr" style={{ display: "table-row" }}>
                  <Box component="th" style={{ display: "table-cell", padding: 8, textAlign: "left" }}>
                    Symbol
                  </Box>
                  <Box component="th" style={{ display: "table-cell", padding: 8, textAlign: "left" }}>
                    Name
                  </Box>
                  <Box component="th" style={{ display: "table-cell", padding: 8, textAlign: "right" }}>
                    P/E
                  </Box>
                  <Box component="th" style={{ display: "table-cell", padding: 8, textAlign: "right" }}>
                    MCap
                  </Box>
                  <Box component="th" style={{ display: "table-cell", padding: 8, textAlign: "right" }}>
                    Price
                  </Box>
                  <Box component="th" style={{ display: "table-cell", padding: 8, textAlign: "right" }}>
                    Change
                  </Box>
                  <Box component="th" style={{ display: "table-cell", padding: 8, textAlign: "left" }}>
                    Sector
                  </Box>
                </Box>
              </Box>
              <Box component="tbody">
                {filteredStocks.slice(0, 100).map((stock) => (
                  <Box
                    key={stock.symbol}
                    component="tr"
                    style={{
                      display: "table-row",
                      backgroundColor: getPeColor(stock.pe_ratio),
                    }}
                  >
                    <Box component="td" style={{ display: "table-cell", padding: 6 }}>
                      {stock.symbol}
                    </Box>
                    <Box component="td" style={{ display: "table-cell", padding: 6 }}>
                      {stock.name?.substring(0, 20)}
                    </Box>
                    <Box component="td" style={{ display: "table-cell", padding: 6, textAlign: "right" }}>
                      {stock.pe_ratio}
                    </Box>
                    <Box component="td" style={{ display: "table-cell", padding: 6, textAlign: "right" }}>
                      {formatMarketCap(stock.market_cap)}
                    </Box>
                    <Box component="td" style={{ display: "table-cell", padding: 6, textAlign: "right" }}>
                      {stock.price ? `₹${stock.price.toFixed(2)}` : "-"}
                    </Box>
                    <Box
                      component="td"
                      style={{
                        display: "table-cell",
                        padding: 6,
                        textAlign: "right",
                        color: stock.change_pct >= 0 ? "green" : "red",
                      }}
                    >
                      {stock.change_pct ? `${stock.change_pct >= 0 ? "+" : ""}${stock.change_pct.toFixed(2)}%` : "-"}
                    </Box>
                    <Box component="td" style={{ display: "table-cell", padding: 6 }}>
                      {stock.sector}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}

        {!heatmapLoading && view === "bars" && (
          <Box p="sm">
            <Text size="sm" c="dimmed">
              Bars view coming soon...
            </Text>
          </Box>
        )}
      </Box>

      <Box
        p="xs"
        style={{
          borderTop: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
        }}
      >
        <Group gap="lg">
          <Group gap={4}>
            <Box style={{ width: 16, height: 16, backgroundColor: PE_COLORS.green, borderRadius: 2 }} />
            <Text size="xs">&lt;10 (Undervalued)</Text>
          </Group>
          <Group gap={4}>
            <Box style={{ width: 16, height: 16, backgroundColor: PE_COLORS["light-green"], borderRadius: 2 }} />
            <Text size="xs">10-15</Text>
          </Group>
          <Group gap={4}>
            <Box style={{ width: 16, height: 16, backgroundColor: PE_COLORS.yellow, borderRadius: 2 }} />
            <Text size="xs">15-20 (Fair)</Text>
          </Group>
          <Group gap={4}>
            <Box style={{ width: 16, height: 16, backgroundColor: PE_COLORS.orange, borderRadius: 2 }} />
            <Text size="xs">20-30</Text>
          </Group>
          <Group gap={4}>
            <Box style={{ width: 16, height: 16, backgroundColor: PE_COLORS.red, borderRadius: 2 }} />
            <Text size="xs">30+ (Overvalued)</Text>
          </Group>
        </Group>
      </Box>
    </Box>
  );
}