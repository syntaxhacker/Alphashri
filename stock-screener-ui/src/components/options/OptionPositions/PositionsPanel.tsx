import { useMemo } from "react";
import { Text, Stack, Badge, Alert } from "@/ui";
import Paper from "@mui/material/Paper";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import TableContainer from "@mui/material/TableContainer";
import CardContent from "@mui/material/CardContent";
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
      <Stack
        id="positions-panel"
        className="positions-panel"
        gap="sm"
        data-testid="options-positions-panel"
      >
        <Text size="lg" fw={600} className="positions-title">
          Positions
        </Text>
        <Text c="dimmed" className="positions-loading" data-testid="options-positions-loading">
          Loading positions...
        </Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack
        id="positions-panel"
        className="positions-panel"
        gap="sm"
        data-testid="options-positions-panel"
      >
        <Text size="lg" fw={600} className="positions-title">
          Positions
        </Text>
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          className="positions-error"
          data-testid="options-positions-error"
        >
          {error}
        </Alert>
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
    <Stack
      id="positions-panel"
      className="positions-panel"
      gap="md"
      data-testid="options-positions-panel"
    >
      <Text size="lg" fw={600} className="positions-title">
        Option Positions
      </Text>

      <Paper sx={{ p: 2 }} className="positions-table-container" data-testid="options-positions-table-container">
        <TableContainer>
          <TanStackTable<Position>
            data={positions}
            columns={columns}
            dataTestId="options-positions-table"
            enableSorting={false}
            emptyMessage="No open positions"
            getRowTestId={(_row, index) => `options-position-row-${index}`}
          />
        </TableContainer>
      </Paper>
    </Stack>
  );
}
