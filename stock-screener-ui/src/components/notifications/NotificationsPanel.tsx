import { useState, useEffect, useCallback } from "react";
import {
  Modal, Stack, Text, Badge, Group, Button, Paper,
  ScrollArea, Loader, Center,
} from "@/ui";
import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import { fetchSurges } from "../../api/notifications";
import type { PriceSurgeEvent } from "../../types/notifications";
import { formatTimeAgo } from "../../utils/ui-helpers";
import { ErrorAlert } from "../common/states";

const PAGE_SIZE = 10;

export function mergeSurgeEvents(previous: PriceSurgeEvent[], next: PriceSurgeEvent[]): PriceSurgeEvent[] {
  return Array.from(
    new Map([...previous, ...next].map((event) => [event.id, event] as const)).values(),
  );
}

export function useSurgeAlertTotal(refreshKey: number = 0): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let active = true;
    fetchSurges(1, 0)
      .then((data) => {
        if (active) setTotal(Number.isFinite(data.total) ? data.total : 0);
      })
      .catch(() => {
        if (active) setTotal(0);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  return total;
}

export function NotificationsPanel({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<PriceSurgeEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(async (pageNum: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchSurges(PAGE_SIZE, pageNum * PAGE_SIZE);
      const incoming = Array.isArray(data.events) ? data.events : [];
      setEvents((prev) => (pageNum === 0 ? incoming : mergeSurgeEvents(prev, incoming)));
      setTotal(Number.isFinite(data.total) ? data.total : 0);
    } catch {
      setLoadError("Could not load surge alerts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opened) {
      setPage(0);
      load(0);
    }
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
        {events.length === 0 && !loading && !loadError && (
          <Center py="xl">
            <Text c="dimmed" size="sm">No surge alerts yet</Text>
          </Center>
        )}

        {loadError && (
          <ErrorAlert
            title="Surge alerts unavailable"
            message={loadError}
            withRetry
            onRetry={() => load(page)}
            data-testid="surge-alerts-error"
          />
        )}

        <ScrollArea
          h={360}
          sx={{ maxHeight: "70vh", minHeight: 180 }}
          data-testid="surge-alerts-scroll"
        >
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
                disabled={loading}
                data-testid="surge-alerts-more"
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
  const sign = isUp ? "+" : "";

  return (
    <Paper p="xs" data-testid={`surge-card-${event.id}`}>
      <Group justify="space-between" align="center" gap={4}>
        <Group align="center" gap={4}>
          {isUp ? <IconTrendingUp size={14} /> : <IconTrendingDown size={14} />}
          <Text size="sm" fw={600}>{event.symbol}</Text>
          <Text size="sm" c={color} fw={600}>{sign}{event.move_pct.toFixed(1)}%</Text>
        </Group>
        <Badge size="xs" variant="light" color="secondary">{event.screen_label}</Badge>
      </Group>
      <Group align="center" gap={4}>
        {event.price != null && (
          <Text size="xs" c="dimmed">₹{event.price.toFixed(2)}</Text>
        )}
        <Text size="xs" c="dimmed">{formatTimeAgo(event.created_at)}</Text>
      </Group>
    </Paper>
  );
}
