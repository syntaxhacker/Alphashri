import { Box, Text, Badge, Group, Flex } from "@/ui";
import type { MantineTheme } from "@/ui";
import { hexToRgba } from "./cellPalette";

interface ChainFooterProps {
  theme: MantineTheme;
  colorScheme: "light" | "dark";
  spotPrice: number | null;
}

export function ChainFooter({ theme, colorScheme, spotPrice }: ChainFooterProps) {
  return (
    <Flex
      className="chain-table-footer"
      p="xs"
      justify="space-between"
      align="center"
      style={{
        borderTop: `1px solid ${hexToRgba(theme.colors.gray[colorScheme === "dark" ? 4 : 3], 0.75)}`,
        background:
          "linear-gradient(90deg, light-dark(rgba(240,253,250,0.9), rgba(12,18,16,0.9)) 0%, light-dark(rgba(248,250,252,0.9), rgba(15,23,42,0.88)) 50%, light-dark(rgba(255,240,245,0.9), rgba(24,12,16,0.9)) 100%)",
      }}
      data-testid="options-chain-table-footer"
    >
      <Group gap="xl" className="chain-legend">
        <Group gap={5} className="chain-legend-item" data-testid="options-legend-itm">
          <Box
            w={10}
            h={10}
            style={{
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(250,204,21,0.45) 0%, rgba(34,197,94,0.28) 100%)",
              border: `1px solid ${hexToRgba(theme.colors.yellow[5], 0.4)}`,
            }}
          />
          <Text size="sm" c="dimmed">
            ITM (In The Money)
          </Text>
        </Group>
        <Group gap={5} className="chain-legend-item" data-testid="options-legend-atm">
          <Box
            w={10}
            h={10}
            style={{
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(253,224,71,0.95) 0%, rgba(251,191,36,0.65) 100%)",
            }}
          />
          <Text size="sm" c="dimmed">
            ATM (At The Money)
          </Text>
        </Group>
        <Group gap={15} className="chain-legend-badges" data-testid="options-legend-badges">
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
        </Group>
      </Group>
      {spotPrice && (
        <Text
          size="sm"
          fw={600}
          className="chain-spot-price"
          data-testid="options-chain-spot-price"
        >
          Spot:{" "}
          <Text component="span" c="blue">
            {spotPrice.toFixed(2)}
          </Text>
        </Text>
      )}
    </Flex>
  );
}
