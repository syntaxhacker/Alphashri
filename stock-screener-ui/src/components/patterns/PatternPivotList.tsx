import { Box, Collapse, Text, UnstyledButton, useDisclosure } from "@/ui";
import { IconChevronDown } from "@tabler/icons-react";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { formatChartTimestamp } from "./datetime";
import { formatPrice } from "./shared";

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
      className="border-t border-fin-border pt-2"
    >
      <UnstyledButton
        onClick={toggle}
        aria-expanded={opened}
        data-testid="patterns-detail-pivots-toggle"
        className="flex w-full items-center gap-1 text-fin-text-muted"
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
        <Box className="flex flex-col gap-[2px] pt-1.5">
          {pivots.map((pivot, i) => (
            <Text
              key={`${pivot.t}-${i}`}
              size="xs"
              c="text.secondary"
              data-testid={`patterns-detail-pivot-${i}`}
            >
              {formatChartTimestamp(pivot.t)} · {formatPrice(pivot.price)} · {pivot.kind === "low" ? "Low" : "High"}
            </Text>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
