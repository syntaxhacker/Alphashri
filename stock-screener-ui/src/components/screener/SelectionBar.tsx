import { Group, Button, Badge } from "@mantine/core";
import { IconChartDots, IconX } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { selectedSymbols, clearSelectedSymbols, subscribe } from "../../state";

interface SelectionBarProps {
  onCompare: () => void;
}

export function SelectionBar({ onCompare }: SelectionBarProps) {
  useStoreSubscription(subscribe);
  if (selectedSymbols.length === 0) return null;

  return (
    <Group
      p="sm"
      gap="sm"
      style={{
        borderTop: "1px solid var(--mantine-color-dark-5)",
        background: "var(--mantine-color-dark-8)",
        flexShrink: 0,
      }}
      data-testid="selection-bar"
    >
      <Badge size="lg" variant="filled" color="blue">
        {selectedSymbols.length} selected
      </Badge>
      <Button
        size="sm"
        variant="subtle"
        color="gray"
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
  );
}
