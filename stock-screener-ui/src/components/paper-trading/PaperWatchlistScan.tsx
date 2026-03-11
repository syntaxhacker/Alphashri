import { Card, Table, Text, Badge } from "@mantine/core";

export interface ScanItem {
  symbol: string;
  ltp: number;
  change: number;
  or_high: number;
  or_low: number;
  breakout_type: "bullish" | "bearish" | null;
}

interface PaperWatchlistScanProps {
  scanItems: ScanItem[];
  onSymbolClick: (symbol: string) => void;
}

function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return "-";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatChange(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function PaperWatchlistScan({ scanItems, onSymbolClick }: PaperWatchlistScanProps) {
  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="watchlist-scan-card">
      <Text fw={600} size="md" mb="md" data-testid="watchlist-header">
        Watchlist Scan
      </Text>

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Symbol</Table.Th>
            <Table.Th>LTP</Table.Th>
            <Table.Th>Change %</Table.Th>
            <Table.Th>OR High</Table.Th>
            <Table.Th>OR Low</Table.Th>
            <Table.Th>Type</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {scanItems.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Text c="dimmed" ta="center">
                  No scan data yet
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : (
            scanItems.map((item) => (
              <Table.Tr
                key={item.symbol}
                onClick={() => onSymbolClick(item.symbol)}
                style={{ cursor: "pointer" }}
                data-testid={`scan-row-${item.symbol}`}
              >
                <Table.Td>
                  <Text fw={600}>{item.symbol}</Text>
                </Table.Td>
                <Table.Td>₹{formatCurrency(item.ltp)}</Table.Td>
                <Table.Td>
                  <Text c={item.change >= 0 ? "green" : "red"}>{formatChange(item.change)}</Text>
                </Table.Td>
                <Table.Td>₹{formatCurrency(item.or_high)}</Table.Td>
                <Table.Td>₹{formatCurrency(item.or_low)}</Table.Td>
                <Table.Td>
                  {item.breakout_type === "bullish" && (
                    <Badge
                      color="green"
                      variant="light"
                      data-testid={`badge-bullish-${item.symbol}`}
                    >
                      Bullish
                    </Badge>
                  )}
                  {item.breakout_type === "bearish" && (
                    <Badge color="red" variant="light" data-testid={`badge-bearish-${item.symbol}`}>
                      Bearish
                    </Badge>
                  )}
                  {item.breakout_type === null && (
                    <Badge
                      color="gray"
                      variant="light"
                      data-testid={`badge-neutral-${item.symbol}`}
                    >
                      -
                    </Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
