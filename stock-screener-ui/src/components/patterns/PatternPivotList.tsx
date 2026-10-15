import { Box, Collapse, Text, UnstyledButton, useDisclosure } from "@/ui";
import { IconChevronDown } from "@tabler/icons-react";
import { formatCurrency } from "@/utils/ui-helpers";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { formatChartTimestamp } from "./datetime";

function price(value: number | null | undefined): string {
  return value == null ? "—" : formatCurrency(value, 2);
}

/**
 * Collapsible audit list of the swing pivots that define the pattern, so a
 * trader can manually verify each turn against the chart. Renders nothing when
 * the hit carries no pivots (older persisted rows).
 */
export function PivotList({ pivots }: { pivots?: PatternHitDTO["pivots"] }) {
  const [opened, { toggle }] = useDisclosure(false);
  if (!pivots?.length) return null;
  return (
    <Box
      data-testid="patterns-detail-pivots"
      sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}
    >
      <UnstyledButton
        onClick={toggle}
        aria-expanded={opened}
        data-testid="patterns-detail-pivots-toggle"
        sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%", color: "text.secondary" }}
      >
        <IconChevronDown
          size={14}
          style={{ transform: opened ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        />
        <Text size="xs" fw={700} style={{ textTransform: "uppercase" }}>
          Pivots
        </Text>
        <Text size="xs" c="dimmed">
          ({pivots.length})
        </Text>
      </UnstyledButton>
      <Collapse in={opened}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, pt: 0.75 }}>
          {pivots.map((pivot, i) => (
            <Text
              key={`${pivot.t}-${i}`}
              size="xs"
              c="text.secondary"
              data-testid={`patterns-detail-pivot-${i}`}
            >
              {formatChartTimestamp(pivot.t)} · {price(pivot.price)} · {pivot.kind === "low" ? "Low" : "High"}
            </Text>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
