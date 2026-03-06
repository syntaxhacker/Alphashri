import { useState } from 'react';
import { Paper, Textarea, Group, Text, ActionIcon, Collapse, CopyButton } from '@mantine/core';
import { IconCopy, IconCheck, IconChevronDown, IconChevronUp } from '@tabler/icons-react';

interface TradingListProps {
  symbols: string[];
  title?: string;
}

export function TradingList({ symbols, title = 'Trading Symbols' }: TradingListProps) {
  const [opened, setOpened] = useState(true);
  const symbolsText = symbols.join(', ');

  return (
    <Paper p="md" withBorder>
      <Group justify="space-between" mb={opened ? 'sm' : 0}>
        <Group gap="xs">
          <ActionIcon variant="subtle" onClick={() => setOpened((o) => !o)}>
            {opened ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </ActionIcon>
          <Text fw={500}>{title}</Text>
          <Text size="sm" c="dimmed">
            ({symbols.length} symbols)
          </Text>
        </Group>
        <CopyButton value={symbolsText}>
          {({ copied, copy }) => (
            <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
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
          styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
        />
      </Collapse>
    </Paper>
  );
}
