import { For } from "solid-js";
import { Modal, Text, Badge, List, ListItem, Box, Stack } from "@/ui";

interface OptionChainGuideProps {
  opened: boolean;
  onClose: () => void;
}

const SENTIMENT = [
  { code: "LB", label: "Long buildup", color: "success", testId: "options-guide-badge-lb" },
  { code: "SB", label: "Short buildup", color: "error", testId: "options-guide-badge-sb" },
  { code: "SC", label: "Short covering", color: "info", testId: "options-guide-badge-sc" },
  { code: "LU", label: "Long unwinding", color: "warning", testId: "options-guide-badge-lu" },
] as const;

export function OptionChainGuide(props: OptionChainGuideProps) {
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="Option chain key"
      size="lg"
      style={{ "border-radius": "6px" }}
      className="option-chain-guide-modal"
      data-testid="options-chain-guide-modal"
    >
      <Stack spacing={1} className="w-full guide-content" data-testid="options-guide-content">
        <Box className="flex flex-wrap items-center gap-2 w-full" data-testid="options-guide-basics">
          <Text size="xs" fw={700}>CALLS (CE)</Text>
          <Text size="xs" c="dimmed">right to buy · expect up</Text>
          <Text size="xs" fw={700}>PUTS (PE)</Text>
          <Text size="xs" c="dimmed">right to sell · expect down</Text>
        </Box>

        <List spacing="xs" size="sm" className="guide-indicators" data-testid="options-guide-indicators">
          <ListItem className="guide-indicator-item" data-testid="options-guide-pcr">
            <Text component="span" fw={700}>PCR</Text> &gt; 1.2 bullish · &lt; 0.7 bearish
          </ListItem>
          <ListItem className="guide-indicator-item" data-testid="options-guide-max-pain">
            <Text component="span" fw={700}>Max Pain</Text> · strike where buyers lose most; expiry magnet, not a target
          </ListItem>
          <ListItem className="guide-indicator-item" data-testid="options-guide-oi">
            <Text component="span" fw={700}>OI</Text> · open contracts; high OI is a wall
          </ListItem>
        </List>

        <Box className="flex flex-wrap gap-1 w-full" data-testid="options-guide-badges">
          <For each={SENTIMENT}>
            {(item) => (
              <Badge size="xs" variant="light" color={item.color} data-testid={item.testId}>
                {item.code} · {item.label}
              </Badge>
            )}
          </For>
        </Box>
      </Stack>
    </Modal>
  );
}
