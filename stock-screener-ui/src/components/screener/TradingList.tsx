import { useState } from "react";
import { Textarea, Group, Text, ActionIcon, Collapse, CopyButton } from "@mantine/core";
import { IconCopy, IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { CompactPanel } from "../common/compact";

interface TradingListProps {
  symbols: string[];
  title?: string;
}

export function TradingList({ symbols, title = "Trading Symbols" }: TradingListProps) {
  const [opened, setOpened] = useState(true);
  const symbolsText = symbols.join(", ");

  return (
    <CompactPanel
      id="trading-list"
      className="trading-list"
      testId="screener-trading-list"
      title={title}
      description={`${symbols.length} symbols`}
    >
      <Group
        justify="space-between"
        mb={opened ? "xs" : 0}
        className="trading-list-header"
        data-testid="trading-list-header"
      >
        <Group gap="xs" className="trading-list-title-group" data-testid="trading-list-title-group">
          <ActionIcon
            variant="subtle"
            onClick={() => setOpened((o) => !o)}
            className="toggle-btn"
            data-testid="trading-list-toggle"
          >
            {opened ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </ActionIcon>
          <Text fw={600} size="sm" className="trading-list-title" data-testid="trading-list-title">
            {title}
          </Text>
          <Text size="xs" c="dimmed" className="symbol-count" data-testid="trading-list-count">
            ({symbols.length} symbols)
          </Text>
        </Group>
        <CopyButton value={symbolsText}>
          {({ copied, copy }) => (
            <ActionIcon
              variant="subtle"
              color={copied ? "teal" : "gray"}
              onClick={copy}
              className="copy-symbols-btn"
              data-testid="copy-trading-symbols-btn"
            >
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          )}
        </CopyButton>
      </Group>
      <Collapse in={opened}>
        <Textarea
          value={symbolsText}
          readOnly
          autosize
          minRows={2}
          maxRows={6}
          styles={{ input: { fontSize: "var(--mantine-font-size-sm)" } }}
          className="trading-list-textarea"
          data-testid="trading-list-textarea"
        />
      </Collapse>
    </CompactPanel>
  );
}
