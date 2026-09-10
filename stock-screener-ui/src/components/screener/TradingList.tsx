import { useState } from "react";
import { Textarea, Group, Text, ActionIcon, Collapse, CopyButton } from "@/ui";
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
      testId="screener-trading-list"
      title={title}
      description={`${symbols.length} symbols`}
    >
      <Group
        justify="space-between"
        align="center"
        mb={opened ? "xs" : 0}
        data-testid="trading-list-header"
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}
      >
        <Group gap="sm" align="center" data-testid="trading-list-title-group" sx={{ display: "flex", alignItems: "center" }}>
          <ActionIcon
            variant="subtle"
            onClick={() => setOpened((o) => !o)}
            data-testid="trading-list-toggle"
          >
            {opened ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </ActionIcon>
          <Text fw={600} size="sm" data-testid="trading-list-title">
            {title}
          </Text>
          <Text size="xs" c="dimmed" data-testid="trading-list-count">
            ({symbols.length} symbols)
          </Text>
        </Group>
        <CopyButton value={symbolsText}>
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
      <Collapse in={opened}>
        <Textarea
          value={symbolsText}
          readOnly
          autosize
          minRows={2}
          maxRows={6}
          styles={{ input: { fontSize: "12px" } }}
          data-testid="trading-list-textarea"
        />
      </Collapse>
    </CompactPanel>
  );
}
