import { Switch, Match } from "solid-js";
import { Text, Badge, Alert, ToolbarRow } from "@/ui";
import { Box } from "@/ui";
import type { TableColumnDef } from "../../common/TanStackTable";
import { IconAlertCircle } from "@/patterns/icons";
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

export function PositionsPanel(props: PositionsPanelProps) {
  const positions = () => props.positions ?? [];

  const columns: TableColumnDef<Position>[] = [
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "trading_symbol",
      cell: (ctx) => (
        <Text fw={500} size="sm">
          {ctx.row.original.trading_symbol}
        </Text>
      ),
    },
    {
      id: "type",
      header: "Type",
      accessorKey: "option_type",
      meta: { align: "center" },
      cell: (ctx) => (
        <Badge
          size="sm"
          color={ctx.row.original.option_type === "CE" ? "success" : "error"}
          variant="light"
        >
          {ctx.row.original.option_type}
        </Badge>
      ),
    },
    {
      id: "strike",
      header: "Strike",
      accessorKey: "strike_price",
      cell: (ctx) => <Text size="sm">{ctx.row.original.strike_price}</Text>,
    },
    {
      id: "qty",
      header: "Qty",
      accessorKey: "quantity",
      cell: (ctx) => <Text size="sm">{ctx.row.original.quantity}</Text>,
    },
    {
      id: "avg_price",
      header: "Avg Price",
      accessorKey: "average_price",
      cell: (ctx) => <Text size="sm">₹{ctx.row.original.average_price.toFixed(2)}</Text>,
    },
    {
      id: "ltp",
      header: "LTP",
      accessorKey: "current_price",
      cell: (ctx) => {
        const val = ctx.row.original.current_price;
        return <Text size="sm">₹{val?.toFixed(2) ?? "-"}</Text>;
      },
    },
    {
      id: "pnl",
      header: "P&L",
      accessorKey: "pnl",
      cell: (ctx) => {
        const val = ctx.row.original.pnl;
        return val !== undefined ? (
          <Text fw={600} c={getPnLTextColor(val)}>
            {formatSignedPnl(val)}
          </Text>
        ) : (
          <Text size="sm">-</Text>
        );
      },
    },
  ];

  return (
    <Switch>
      <Match when={props.loading}>
        <Box id="positions-panel" className="positions-panel flex flex-col gap-[8px] w-full" data-testid="options-positions-panel">
          <ToolbarRow gap={8}>
            <Text size="md" fw={600} className="positions-title">
              Positions
            </Text>
          </ToolbarRow>
          <Box className="flex items-center justify-center w-full py-8">
            <Text size="sm" className="text-fin-text-muted positions-loading" data-testid="options-positions-loading">
              Loading positions...
            </Text>
          </Box>
        </Box>
      </Match>
      <Match when={props.error}>
        <Box id="positions-panel" className="positions-panel flex flex-col gap-[8px] w-full" data-testid="options-positions-panel">
          <ToolbarRow gap={8}>
            <Text size="md" fw={600} className="positions-title">
              Positions
            </Text>
          </ToolbarRow>
          <Alert icon={<IconAlertCircle size={16} />} color="error" variant="light" className="positions-error" data-testid="options-positions-error">
            {props.error}
          </Alert>
        </Box>
      </Match>
      <Match when={true}>
        <Box id="positions-panel" className="positions-panel flex flex-col gap-[8px] w-full" data-testid="options-positions-panel">
          <ToolbarRow gap={8}>
            <Text size="md" fw={600} className="positions-title">
              Option Positions
            </Text>
            <Badge size="xs" variant="filled" color="info" data-testid="options-positions-count">
              {positions().length}
            </Badge>
          </ToolbarRow>
          <Box className="positions-table-container overflow-x-auto w-full" data-testid="options-positions-table-container">
            <TanStackTable<Position>
              data={positions()}
              columns={columns}
              dataTestId="options-positions-table"
              enableSorting={false}
              emptyMessage="No open positions"
              getRowTestId={(_row, index) => `options-position-row-${index}`}
            />
          </Box>
        </Box>
      </Match>
    </Switch>
  );
}
