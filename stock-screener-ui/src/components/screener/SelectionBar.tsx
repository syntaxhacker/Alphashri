import { memo } from "react";
import { alpha } from "@/ui/alpha";
import { Box, Group, Button, Badge } from "@/ui";
import { BLACK } from "@/ui/palette";
import { IconChartDots, IconX } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { selectedSymbols, clearSelectedSymbols, subscribeToSelection } from "../../state";

interface SelectionBarProps {
  onCompare: () => void;
}

export const SelectionBar = memo(function SelectionBar({ onCompare }: SelectionBarProps) {
  useStoreSubscription(subscribeToSelection);
  if (selectedSymbols.length === 0) return null;

  return (
    <Box p={1} className="flex items-center justify-center flex-shrink-0" style={{ background: alpha(BLACK, 0.9) }}>
      <Group
        p="sm"
        gap="sm"
        justify="center"
        align="center"
        className="flex items-center justify-center"
        data-testid="selection-bar"
      >
      <Badge size="lg" variant="filled" color="primary">
        {selectedSymbols.length} selected
      </Badge>
      <Button
        size="sm"
        variant="subtle"
        color="secondary"
        leftSection={<IconX size={14} />}
        onClick={clearSelectedSymbols}
        data-testid="clear-selection-btn"
      >
        Clear
      </Button>
      <Button
        size="sm"
        leftSection={<IconChartDots size={16} />}
        onClick={onCompare}
        disabled={selectedSymbols.length < 2}
        data-testid="compare-btn"
      >
        Compare
      </Button>
      </Group>
    </Box>
  );
});
