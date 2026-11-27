import { Show } from "solid-js";
import { alpha } from "@/ui/alpha";
import { Box, Group, Button, Badge } from "@/ui";
import { BLACK } from "@/ui/palette";
import { IconChartDots, IconX } from "./icons";
import { selectedSymbols, clearSelectedSymbols, subscribeToSelection } from "../../state";
import { useStoreSnapshot } from "../../hooks/useStoreSubscription";

interface SelectionBarProps {
  onCompare: () => void;
}

export function SelectionBar(props: SelectionBarProps) {
  const selection = useStoreSnapshot(subscribeToSelection, () => selectedSymbols);
  const count = () => selection().length;

  return (
    <Show when={count() > 0}>
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
            {count()} selected
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
            onClick={props.onCompare}
            disabled={count() < 2}
            data-testid="compare-btn"
          >
            Compare
          </Button>
        </Group>
      </Box>
    </Show>
  );
}
