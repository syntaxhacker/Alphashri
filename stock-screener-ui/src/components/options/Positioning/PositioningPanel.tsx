import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Stack } from "@/ui";
import { Box } from "@/ui";
import { Anchor, Button, Skeleton, Text } from "@/ui";
import { getPositioning, PositioningApiError } from "../../../api/upstoxOptions";
import type {
  PositioningData,
  PositioningMode,
  PositioningView,
} from "@/utils/positioning";
import { PositioningHeader } from "./PositioningHeader";
import { VerdictBanner } from "./VerdictBanner";
import { ReadingTable } from "./ReadingTable";
import { PositioningStrikeTable } from "./PositioningStrikeTable";
import { PositioningChart } from "./PositioningChart";
import { EmptyState } from "../../common/states";

interface PositioningPanelProps {
  underlying: string;
  expiry: string;
}

export function PositioningPanel(props: PositioningPanelProps) {
  const [selUnderlying, setSelUnderlying] = createSignal(props.underlying);
  const [mode, setMode] = createSignal<PositioningMode>("since_open");
  const [view, setView] = createSignal<PositioningView>("table");
  const [data, setData] = createSignal<PositioningData | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<{ message: string; status?: number } | null>(null);
  const [attempt, setAttempt] = createSignal(0);

  createEffect(() => {
    setSelUnderlying(props.underlying);
  });

  const retry = () => setAttempt((a) => a + 1);

  createEffect(() => {
    const u = selUnderlying();
    const expiry = props.expiry;
    const m = mode();
    attempt();
    if (!u || !expiry) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getPositioning(u, expiry, m).then(
      (res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        const status =
          err instanceof PositioningApiError
            ? err.status
            : (err as { status?: number } | null)?.status;
        setError({
          message: err instanceof Error ? err.message : "Failed to fetch positioning",
          status,
        });
        setLoading(false);
      },
    );
    onCleanup(() => {
      cancelled = true;
    });
  });

  const isUnauthorized = () => error()?.status === 401;

  return (
    <Stack
      id="positioning-panel"
      data-testid="positioning-panel"
      spacing={1}
      className="flex flex-col w-full min-h-0 p-[16px]"
    >
      <PositioningHeader
        underlying={selUnderlying()}
        onUnderlyingChange={setSelUnderlying}
        mode={mode()}
        onModeChange={setMode}
        view={view()}
        onViewChange={setView}
        timestamp={data()?.timestamp}
      />

      <Show when={loading()}>
        <Stack data-testid="positioning-loading" spacing={1}>
          <Skeleton h={64} radius="sm" />
          <Skeleton h={120} radius="sm" />
          <Skeleton h={200} radius="sm" />
        </Stack>
      </Show>

      <Show when={!loading() && error()}>
        <Box data-testid="positioning-error" className="flex flex-col gap-[64px]">
          <Text size="sm" className="text-fin-negative">
            {isUnauthorized()
              ? "Upstox connection required to load positioning."
              : error()?.message}
          </Text>
          <Show when={isUnauthorized()}>
            <Anchor href="/settings" data-testid="positioning-connect">
              Connect Upstox in Settings
            </Anchor>
          </Show>
          <Box>
            <Button size="sm" onClick={retry} data-testid="positioning-retry">
              Retry
            </Button>
          </Box>
        </Box>
      </Show>

      <Show when={!loading() && !error() && data()}>
        {(d) => (
          <Show
            when={d().rows.length === 0}
            fallback={
              <Stack spacing={2} className="flex flex-col">
                <VerdictBanner data={d()} />
                <ReadingTable data={d()} />
                <Show when={view() === "table"} fallback={<PositioningChart rows={d().rows} />}>
                  <PositioningStrikeTable rows={d().rows} />
                </Show>
              </Stack>
            }
          >
            <EmptyState
              data-testid="positioning-empty"
              title="No positioning data"
              description="No strikes with readable positioning for this expiry."
            />
          </Show>
        )}
      </Show>
    </Stack>
  );
}
