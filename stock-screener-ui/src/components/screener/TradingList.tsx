import { createSignal, Show } from "solid-js";
import { Textarea, Group, Text, ActionIcon, Collapse, CopyButton } from "@/ui";
import { IconCopy, IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { CompactPanel } from "../common/compact";

interface TradingListProps {
  symbols: string[];
  title?: string;
}

export function TradingList(props: TradingListProps) {
  const [opened, setOpened] = createSignal(true);
  const title = () => props.title ?? "Trading Symbols";
  const symbolsText = () => props.symbols.join(", ");

  return (
    <CompactPanel
      id="trading-list"
      testId="screener-trading-list"
      title={title()}
      description={`${props.symbols.length} symbols`}
    >
      <Group
        justify="space-between"
        align="center"
        mb={opened() ? "xs" : 0}
        data-testid="trading-list-header"
        className="flex w-full items-center justify-between gap-2"
      >
        <Group gap="sm" align="center" data-testid="trading-list-title-group" className="flex items-center">
          <ActionIcon
            variant="subtle"
            onClick={() => setOpened((o) => !o)}
            data-testid="trading-list-toggle"
          >
            <Show when={opened()} fallback={<IconChevronDown size={14} />}>
              <IconChevronUp size={14} />
            </Show>
          </ActionIcon>
          <Text fw={600} size="sm" data-testid="trading-list-title">
            {title()}
          </Text>
          <Text size="xs" c="dimmed" data-testid="trading-list-count">
            ({props.symbols.length} symbols)
          </Text>
        </Group>
        <CopyButton value={symbolsText()}>
          {({ copied, copy }) => (
            <ActionIcon
              variant="subtle"
              color={copied ? "info" : "secondary"}
              onClick={copy}
              data-testid="copy-trading-symbols-btn"
            >
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          )}
        </CopyButton>
      </Group>
      <Collapse in={opened()}>
        <Textarea
          value={symbolsText()}
          readOnly
          autosize
          minRows={2}
          maxRows={6}
          className="[&_textarea]:text-xs"
          data-testid="trading-list-textarea"
        />
      </Collapse>
    </CompactPanel>
  );
}
