import { Table, TableThead, TableTbody, TableTr, TableTh, TableTd, Text, Stack, Badge, Paper, Alert } from "@/ui";
import { IconAlertCircle } from "@tabler/icons-react";
import { DataTable } from "../../common/DataTable";
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

      <Paper
        withBorder
        p="md"
        className="positions-table-container"
        data-testid="options-positions-table-container"
      >
        <DataTable striped={false} className="positions-table" dataTestId="options-positions-table">
          <TableThead className="positions-table-head">
            <TableTr className="positions-header-row">
              <TableTh className="positions-header-cell">Symbol</TableTh>
              <TableTh className="positions-header-cell">Type</TableTh>
              <TableTh className="positions-header-cell">Strike</TableTh>
              <TableTh className="positions-header-cell">Qty</TableTh>
              <TableTh className="positions-header-cell">Avg Price</TableTh>
              <TableTh className="positions-header-cell">LTP</TableTh>
              <TableTh className="positions-header-cell">P&L</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody className="positions-table-body">
            {positions.length === 0 ? (
              <TableTr className="positions-empty-row" data-testid="options-positions-empty">
                <TableTd colSpan={7} align="center">
                  <Text c="dimmed" py="md">
                    No open positions
                  </Text>
                </TableTd>
              </TableTr>
            ) : (
              positions.map((pos, index) => (
                <TableTr
                  key={pos.instrument_key}
                  className="position-row"
                  data-testid={`options-position-row-${index}`}
                >
                  <TableTd
                    fw={500}
                    className="position-symbol"
                    data-testid={`options-position-symbol-${index}`}
                  >
                    {pos.trading_symbol}
                  </TableTd>
                  <TableTd className="position-type">
                    <Badge
                      size="sm"
                      color={pos.option_type === "CE" ? "green" : "red"}
                      variant="light"
                      data-testid={`options-position-type-${index}`}
                    >
                      {pos.option_type}
                    </Badge>
                  </TableTd>
                  <TableTd
                    className="position-strike"
                    data-testid={`options-position-strike-${index}`}
                  >
                    {pos.strike_price}
                  </TableTd>
                  <TableTd className="position-qty" data-testid={`options-position-qty-${index}`}>
                    {pos.quantity}
                  </TableTd>
                  <TableTd
                    className="position-avg-price"
                    data-testid={`options-position-avg-price-${index}`}
                  >
                    ₹{pos.average_price.toFixed(2)}
                  </TableTd>
                  <TableTd className="position-ltp" data-testid={`options-position-ltp-${index}`}>
                    ₹{pos.current_price?.toFixed(2) ?? "-"}
                  </TableTd>
                  <TableTd className="position-pnl" data-testid={`options-position-pnl-${index}`}>
                    {pos.pnl !== undefined ? (
                      <Text fw={600} c={getPnLTextColor(pos.pnl)}>
                        {formatSignedPnl(pos.pnl)}
                      </Text>
                    ) : (
                      "-"
                    )}
                  </TableTd>
                </TableTr>
              ))
            )}
          </TableTbody>
        </DataTable>
      </Paper>
    </Stack>
  );
}
