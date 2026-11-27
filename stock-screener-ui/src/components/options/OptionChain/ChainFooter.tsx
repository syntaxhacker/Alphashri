import { Show } from "solid-js";
import { Box } from "@/ui";
import { Text, Badge } from "@/ui";
import * as palette from "@/ui/palette";

interface ChainFooterProps {
  theme: any;
  colorScheme: "light" | "dark";
  spotPrice: number | null;
}

export function ChainFooter(props: ChainFooterProps) {
  return (
    <Box
      className="chain-table-footer flex items-center justify-center gap-[8px] p-[8px] flex-wrap w-full"
      style={{ "background-color": palette.SURFACE, "flex-wrap": "wrap" }}
      data-testid="options-chain-table-footer"
    >
      <Box className="flex items-center gap-[8px] p-[8px] flex-wrap justify-center">
        <Box className="flex items-center gap-[4px]" data-testid="options-legend-itm">
          <Box style={{ width: "10px", height: "10px", "border-radius": "9999px", "background-color": palette.POSITIVE }} />
          <Text size="sm" className="text-fin-text-muted">
            ITM
          </Text>
        </Box>
        <Box className="flex items-center gap-[4px]" data-testid="options-legend-atm">
          <Box style={{ width: "10px", height: "10px", "border-radius": "9999px", "background-color": palette.WARNING }} />
          <Text size="sm" className="text-fin-text-muted">
            ATM
          </Text>
        </Box>
        <Box className="flex items-center gap-[8px] flex-wrap" data-testid="options-legend-badges">
          <Badge size="sm" variant="light" color="success">LB</Badge>
          <Badge size="sm" variant="light" color="error">SB</Badge>
          <Badge size="sm" variant="light" color="info">SC</Badge>
          <Badge size="sm" variant="light" color="warning">LU</Badge>
        </Box>
      </Box>
      <Show when={props.spotPrice}>
        {(spot) => (
          <Text size="sm" fw={600} className="chain-spot-price" data-testid="options-chain-spot-price">
            Spot:{" "}
            <Text component="span" className="text-fin-primary">
              {spot().toFixed(2)}
            </Text>
          </Text>
        )}
      </Show>
    </Box>
  );
}
