import { useState } from "react";
import {
  Paper,
  Textarea,
  Group,
  Text,
  ActionIcon,
  Collapse,
  CopyButton,
  useMantineTheme,
} from "@mantine/core";
import { IconCopy, IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";

interface TradingListProps {
  symbols: string[];
  title?: string;
}

export function TradingList({ symbols, title = "Trading Symbols" }: TradingListProps) {
  const theme = useMantineTheme();
  const [opened, setOpened] = useState(true);
  const symbolsText = symbols.join(", ");

  return (
    <Paper
      p="md"
      withBorder
      id="trading-list"
      className="trading-list"
      data-testid="screener-trading-list"
    >
      <Group
        justify="space-between"
        mb={opened ? "sm" : 0}
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
            {opened ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </ActionIcon>
          <Text fw={500} className="trading-list-title" data-testid="trading-list-title">
            {title}
          </Text>
          <Text size="sm" c="dimmed" className="symbol-count" data-testid="trading-list-count">
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
          styles={{ input: { fontFamily: theme.fontFamily, fontSize: theme.fontSizes.md } }}
          className="trading-list-textarea"
          data-testid="trading-list-textarea"
        />
      </Collapse>
    </Paper>
  );
}
