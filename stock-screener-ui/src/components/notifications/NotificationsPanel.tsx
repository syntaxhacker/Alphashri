import { Show, For, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import {
  Modal, Stack, Text, Badge, Group, Button, Paper,
  ScrollArea, Loader, Center,
} from "@/ui";
import { IconTrendingDown, IconTrendingUp } from "../common/Icons";
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

/** Fetches the surge-alert total; `refreshKey` may be a value or an accessor — the refetch re-arms whenever it changes. */
export function useSurgeAlertTotal(refreshKey: number | (() => number) = 0): () => number {
  const [total, setTotal] = createSignal(0);

  createEffect(() => {
    const key = typeof refreshKey === "function" ? refreshKey() : refreshKey;
    void key;
    let active = true;
    fetchSurges(1, 0)
      .then((data) => {
        if (active) setTotal(Number.isFinite(data.total) ? data.total : 0);
      })
      .catch(() => {
        if (active) setTotal(0);
      });
    onCleanup(() => {
      active = false;
    });
  });

  return total;
}

export function NotificationsPanel(props: { opened: boolean; onClose: () => void }) {
  const [events, setEvents] = createSignal<PriceSurgeEvent[]>([]);
  const [total, setTotal] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [page, setPage] = createSignal(0);

  const load = async (pageNum: number) => {
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
  };

  createEffect(() => {
    if (props.opened) {
      setPage(0);
      void load(0);
    }
  });

  const hasMore = () => events().length < total();

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={`Surge Alerts (${total()})`}
      size="sm"
    >
      <Stack gap="xs">
        <Show when={events().length === 0 && !loading() && !loadError()}>
          <Center py="xl">
            <Text c="dimmed" size="sm">No surge alerts yet</Text>
          </Center>
        </Show>

        <Show when={loadError()}>
          {(message) => (
            <ErrorAlert
              title="Surge alerts unavailable"
              message={message()}
              withRetry
              onRetry={() => void load(page())}
              data-testid="surge-alerts-error"
            />
          )}
        </Show>

        <ScrollArea
          h={360}
          style={{ "max-height": "70vh", "min-height": "180px" }}
          data-testid="surge-alerts-scroll"
        >
          <Stack gap="xs">
            <For each={events()}>{(ev) => <SurgeCard event={ev} />}</For>
          </Stack>

          <Show when={hasMore()}>
            <Center py="md">
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  const next = page() + 1;
                  setPage(next);
                  void load(next);
                }}
                loading={loading()}
                disabled={loading()}
                data-testid="surge-alerts-more"
              >
                Show more
              </Button>
            </Center>
          </Show>

          <Show when={loading() && events().length > 0}>
            <Center py="md"><Loader size="sm" /></Center>
          </Show>
        </ScrollArea>
      </Stack>
    </Modal>
  );
}

function SurgeCard(props: { event: PriceSurgeEvent }) {
  const isUp = () => props.event.direction === "up";
  const color = () => (isUp() ? "success" : "error");
  const sign = () => (isUp() ? "+" : "");

  return (
    <Paper p="xs" data-testid={`surge-card-${props.event.id}`}>
      <Group justify="space-between" align="center" gap={4}>
        <Group align="center" gap={4}>
          <Show when={isUp()} fallback={<IconTrendingDown size={14} />}>
            <IconTrendingUp size={14} />
          </Show>
          <Text size="sm" fw={600}>{props.event.symbol}</Text>
          <Text size="sm" c={color()} fw={600}>{sign()}{props.event.move_pct.toFixed(1)}%</Text>
        </Group>
        <Badge size="xs" variant="light" color="secondary">{props.event.screen_label}</Badge>
      </Group>
      <Group align="center" gap={4}>
        <Show when={props.event.price != null}>
          <Text size="xs" c="dimmed">₹{props.event.price!.toFixed(2)}</Text>
        </Show>
        <Text size="xs" c="dimmed">{formatTimeAgo(props.event.created_at)}</Text>
      </Group>
    </Paper>
  );
}
