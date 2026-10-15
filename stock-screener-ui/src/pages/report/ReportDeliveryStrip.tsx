import { Alert, Badge, Box, Paper, Skeleton, Text } from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import type { DeliveryResponse } from "../../types/report";
import { formatCurrency, formatNumber } from "../../utils/ui-helpers";

interface ReportDeliveryStripProps {
  data: DeliveryResponse | null;
  loading: boolean;
  error: string | null;
  onOpenSymbol?: (symbol: string) => void;
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

export function ReportDeliveryStrip({ data, loading, error, onOpenSymbol }: ReportDeliveryStripProps) {
  if (loading) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }} data-testid="report-delivery-loading">
        <Skeleton h={16} />
        <Skeleton h={16} />
      </Box>
    );
  }
  if (error) {
    return (
      <Box data-testid="report-delivery-error">
        <Alert color="error" data-testid="report-delivery-error-alert">
          {error}
        </Alert>
      </Box>
    );
  }
  const rows = data?.rows ?? [];
  if (rows.length === 0) return null;
  return (
    <Paper
      data-testid="report-delivery-strip"
      sx={{ minWidth: 0, border: 1, borderColor: BORDER, borderRadius: 2, bgcolor: SURFACE }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, pt: 1 }}>
        <Text size="xs" fw={600} truncate span sx={{ flex: 1, minWidth: 0 }} data-testid="report-delivery-title">
          High delivery %
        </Text>
        <Badge size="xs" data-testid="report-delivery-date">
          {data?.date ?? ""}
        </Badge>
        <Badge size="xs" data-testid="report-delivery-source">
          NSE bhavcopy
        </Badge>
      </Box>
      <Box
        data-testid="report-delivery-rows"
        sx={{ display: "flex", gap: 1, overflowX: "auto", px: 1, py: 1, fontVariantNumeric: "tabular-nums" }}
      >
        {rows.map((row) => (
          <Box
            key={row.symbol}
            data-testid={`report-delivery-row-${row.symbol}`}
            data-symbol={row.symbol}
            role={onOpenSymbol ? "button" : undefined}
            tabIndex={onOpenSymbol ? 0 : undefined}
            onClick={onOpenSymbol ? () => onOpenSymbol(row.symbol) : undefined}
            onKeyDown={
              onOpenSymbol
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenSymbol(row.symbol);
                    }
                  }
                : undefined
            }
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              minWidth: 120,
              flexShrink: 0,
              cursor: onOpenSymbol ? "pointer" : "default",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <Text size="xs" fw={700} truncate span title={row.symbol}>
              {row.symbol}
            </Text>
            <Text size="xs" fw={700} span sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatPct(row.delivery_pct)}
            </Text>
            <Text size="xs" c="dimmed" span sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatNumber(row.delivery_qty)} / {formatNumber(row.traded_qty)}
            </Text>
            <Text size="xs" c="dimmed" span sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatCurrency(row.close, 2)}
            </Text>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
