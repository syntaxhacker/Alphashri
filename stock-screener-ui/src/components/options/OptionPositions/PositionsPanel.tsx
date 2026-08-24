import { useMemo } from "react";
import { Text, Badge, Alert } from "@/ui";
import Paper from "@mui/material/Paper";
import TableContainer from "@mui/material/TableContainer";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import type { ColumnDef } from "@tanstack/react-table";
import { IconAlertCircle } from "@tabler/icons-react";
import { TanStackTable } from "../../common/TanStackTable";
import { getPnLTextColor, formatSignedPnl } from "../../../utils/ui-helpers";

interface Position {
  instrument_key: string;
  trading_symbol: string;
  option_type: string;
  strike_price: number;
  quantity: number;
  average_price: number;
  current_price?: number;
  pnl?: number;
}

interface PositionsPanelProps {
  positions: Position[];
  loading?: boolean;
  error?: string | null;
}

export function PositionsPanel({ positions = [], loading, error }: PositionsPanelProps) {
  if (loading) {
    return (
      <Stack id="positions-panel" className="positions-panel" spacing={1} sx={{ alignItems: "center", justifyContent: "center", width: "100%" }} data-testid="options-positions-panel">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <Text size="lg" fw={600} className="positions-title" style={{ textAlign: "center" as any }}>
            Positions
          </Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <Text c="dimmed" className="positions-loading" data-testid="options-positions-loading" sx={{ textAlign: "center" }}>
            Loading positions...
          </Text>
        </Box>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack id="positions-panel" className="positions-panel" spacing={1} sx={{ alignItems: "center", justifyContent: "center", width: "100%" }} data-testid="options-positions-panel">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <Text size="lg" fw={600} className="positions-title" style={{ textAlign: "center" as any }}>
            Positions
          </Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" className="positions-error" data-testid="options-positions-error">
            {error}
          </Alert>
        </Box>
      </Stack>
    );
  }

  const columns = useMemo<ColumnDef<Position>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "trading_symbol",
        cell: (info) => (
          <Text fw={500} size="sm">
            {info.getValue<string>()}
          </Text>
        ),
      },
      {
        id: "type",
        header: "Type",
        accessorKey: "option_type",
        cell: (info) => (
          <Badge
            size="sm"
            color={info.getValue<string>() === "CE" ? "green" : "red"}
            variant="light"
          >
            {info.getValue<string>()}
          </Badge>
        ),
      },
      {
        id: "strike",
        header: "Strike",
        accessorKey: "strike_price",
        cell: (info) => (
          <Text size="sm">{info.getValue<number>()}</Text>
        ),
      },
      {
        id: "qty",
        header: "Qty",
        accessorKey: "quantity",
        cell: (info) => (
          <Text size="sm">{info.getValue<number>()}</Text>
        ),
      },
      {
        id: "avg_price",
        header: "Avg Price",
        accessorKey: "average_price",
        cell: (info) => (
          <Text size="sm">₹{info.getValue<number>().toFixed(2)}</Text>
        ),
      },
      {
        id: "ltp",
        header: "LTP",
        accessorKey: "current_price",
        cell: (info) => {
          const val = info.getValue<number | undefined>();
          return <Text size="sm">₹{val?.toFixed(2) ?? "-"}</Text>;
        },
      },
      {
        id: "pnl",
        header: "P&L",
        accessorKey: "pnl",
        cell: (info) => {
          const val = info.getValue<number | undefined>();
          return val !== undefined ? (
            <Text fw={600} c={getPnLTextColor(val)}>
              {formatSignedPnl(val)}
            </Text>
          ) : (
            <Text size="sm">-</Text>
          );
        },
      },
    ],
    [],
  );

  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
      <Grid container spacing={1} sx={{ justifyContent: "center", alignItems: "center", width: "100%", maxWidth: 1000 }}>
        <Grid size={{ xs: 12 }} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Stack id="positions-panel" className="positions-panel" spacing={1} sx={{ alignItems: "center", justifyContent: "center", width: "100%" }} data-testid="options-positions-panel">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
              <Text size="lg" fw={600} className="positions-title" style={{ textAlign: "center" as any }}>
                Option Positions
              </Text>
            </Box>
            <Paper elevation={1} sx={{ p: 1, width: "100%" }} className="positions-table-container" data-testid="options-positions-table-container">
              <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                <TableContainer component={Paper} elevation={1}>
                  <TanStackTable<Position>
                    data={positions}
                    columns={columns}
                    dataTestId="options-positions-table"
                    enableSorting={false}
                    emptyMessage="No open positions"
                    getRowTestId={(_row, index) => `options-position-row-${index}`}
                  />
                </TableContainer>
              </CardContent>
            </Paper>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
