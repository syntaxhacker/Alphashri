import { useState, useEffect, useCallback } from "react";
import {
  Modal, Stack, Text, Badge, Group, Button, Paper,
  ScrollArea, Loader, Center,
} from "@/ui";
import { fetchSurges } from "../../api/notifications";
import type { PriceSurgeEvent } from "../../types/notifications";

const PAGE_SIZE = 10;

export function NotificationsPanel({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<PriceSurgeEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);

  const load = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const data = await fetchSurges(PAGE_SIZE, pageNum * PAGE_SIZE);
      if (pageNum === 0) setEvents(data.events);
      else setEvents((prev) => [...prev, ...data.events]);
      setTotal(data.total);
    } catch {
      // Silently fail — non-critical feature
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opened) load(0);
  }, [opened, load]);

  const hasMore = events.length < total;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Surge Alerts (${total})`}
      size="sm"
    >
      <Stack gap="xs">
        {events.length === 0 && !loading && (
          <Center py="xl">
            <Text c="dimmed" size="sm">No surge alerts yet</Text>
          </Center>
        )}

        <ScrollArea h="calc(100vh - 260px)">
          <Stack gap="xs">
            {events.map((ev) => (
              <SurgeCard key={ev.id} event={ev} />
            ))}
          </Stack>

          {hasMore && (
            <Center py="md">
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  load(next);
                }}
                loading={loading}
              >
                Show more
              </Button>
            </Center>
          )}

          {loading && events.length > 0 && (
            <Center py="md"><Loader size="sm" /></Center>
          )}
        </ScrollArea>
      </Stack>
    </Modal>
  );
}

function SurgeCard({ event }: { event: PriceSurgeEvent }) {
  const isUp = event.direction === "up";
  const color = isUp ? "success" : "error";
  const icon = isUp ? "\u{1F680}" : "\u{1F4C9}";
  const sign = isUp ? "+" : "";

  const time = new Date(event.created_at);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Paper p="xs" withBorder data-testid={`surge-card-${event.id}`}>
      <Group justify="space-between" gap={4}>
        <Group gap={4}>
          <Text size="sm" fw={600}>{icon} {event.symbol}</Text>
          <Text size="sm" c={color} fw={600}>{sign}{event.move_pct.toFixed(1)}%</Text>
        </Group>
        <Badge size="xs" variant="light" color="secondary">{event.screen_label}</Badge>
      </Group>
      <Group gap={4}>
        {event.price != null && (
          <Text size="xs" c="dimmed">₹{event.price.toFixed(2)}</Text>
        )}
        <Text size="xs" c="dimmed">{timeStr}</Text>
      </Group>
    </Paper>
  );
}
