import Box from "@mui/material/Box";
import { Text, Badge } from "@/ui";

interface ChainFooterProps {
  theme: any;
  colorScheme: "light" | "dark";
  spotPrice: number | null;
}

export function ChainFooter({ spotPrice }: ChainFooterProps) {
  return (
    <Box
      className="chain-table-footer"
      data-testid="options-chain-table-footer"
      sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, bgcolor: "background.paper", flexWrap: "wrap", width: "100%" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, flexWrap: "wrap", justifyContent: "center" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }} data-testid="options-legend-itm">
          <Box sx={{ width: 10, height: 10, borderRadius: 999, bgcolor: "success.main" }} />
          <Text size="sm" c="dimmed">
            ITM (In The Money)
          </Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }} data-testid="options-legend-atm">
          <Box sx={{ width: 10, height: 10, borderRadius: 999, bgcolor: "warning.main" }} />
          <Text size="sm" c="dimmed">
            ATM (At The Money)
          </Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }} data-testid="options-legend-badges">
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
        </Box>
      </Box>
      {spotPrice && (
        <Text size="sm" fw={600} className="chain-spot-price" data-testid="options-chain-spot-price">
          Spot:{" "}
          <Text component="span" c="blue">
            {spotPrice.toFixed(2)}
          </Text>
        </Text>
      )}
    </Box>
  );
}
