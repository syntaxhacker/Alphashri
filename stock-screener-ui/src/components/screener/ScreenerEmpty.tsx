import { Center, Text } from '@mantine/core';
import { IconDatabaseOff } from '@tabler/icons-react';

interface ScreenerEmptyProps {
  message?: string;
}

export function ScreenerEmpty({ message = 'No results found' }: ScreenerEmptyProps) {
  return (
    <Center h={200} style={{ flexDirection: 'column', gap: 12 }}>
      <IconDatabaseOff size={48} stroke={1.5} opacity={0.5} />
      <Text c="dimmed" size="lg">
        {message}
      </Text>
    </Center>
  );
}
