import { useMemo } from "react";
import { Text, Badge, Alert, ToolbarRow } from "@/ui";
import Box from "@mui/material/Box";
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
      <Box id="positions-panel" className="positions-panel" sx={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }} data-testid="options-positions-panel">
        <ToolbarRow gap={8}>
          <Text size="md" fw={600} className="positions-title">
            Positions
          </Text>
        </ToolbarRow>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 4, width: "100%" }}>
          <Text size="sm" c="dimmed" className="positions-loading" data-testid="options-positions-loading">
            Loading positions...
          </Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box id="positions-panel" className="positions-panel" sx={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }} data-testid="options-positions-panel">
        <ToolbarRow gap={8}>
          <Text size="md" fw={600} className="positions-title">
            Positions
          </Text>
        </ToolbarRow>
        <Alert icon={<IconAlertCircle size={16} />} color="error" variant="light" className="positions-error" data-testid="options-positions-error">
          {error}
        </Alert>
      </Box>
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
        meta: { align: "center" },
        cell: (info) => (
          <Badge
            size="sm"
            color={info.getValue<string>() === "CE" ? "success" : "error"}
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
    <Box id="positions-panel" className="positions-panel" sx={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }} data-testid="options-positions-panel">
      <ToolbarRow gap={8}>
        <Text size="md" fw={600} className="positions-title">
          Option Positions
        </Text>
        <Badge size="xs" variant="filled" color="info" data-testid="options-positions-count">
          {positions.length}
        </Badge>
      </ToolbarRow>
      <Box className="positions-table-container" data-testid="options-positions-table-container" sx={{ width: "100%", overflowX: "auto" }}>
        <TanStackTable<Position>
          data={positions}
          columns={columns}
          dataTestId="options-positions-table"
          enableSorting={false}
          emptyMessage="No open positions"
          getRowTestId={(_row, index) => `options-position-row-${index}`}
        />
      </Box>
    </Box>
  );
}
