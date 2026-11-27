import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Box, Button, Skeleton, Stack, Text } from "@/ui";
import { getPositioning } from "../../../api/upstoxOptions";
import { ApiError } from "@/api/apiError";
import { DEFAULT_RATE_LIMIT_RETRY_MS } from "@/state/optionsDock";
import { BrokerAuthNotice, isBrokerAuthKind } from "@/components/common/BrokerAuthNotice";
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
  const [error, setError] = createSignal<{
    message: string;
    kind: string | null;
    retryAfterMs: number | null;
  } | null>(null);
  const [retryReady, setRetryReady] = createSignal(true);
  const [attempt, setAttempt] = createSignal(0);

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const clearRetryTimer = () => {
    if (retryTimer != null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

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
    clearRetryTimer();
    setLoading(true);
    setError(null);
    setRetryReady(true);
    void getPositioning(u, expiry, m).then(
      (res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        // The typed error kind — never a status boolean from another fetch and
        // never a message string — decides whether this is an auth state.
        const kind = err instanceof ApiError ? err.kind : null;
        const retryAfterMs = kind === "rate_limited" && err instanceof ApiError ? err.retryAfterMs : null;
        setError({
          message: err instanceof Error ? err.message : "Failed to fetch positioning",
          kind,
          retryAfterMs,
        });
        if (kind === "rate_limited") {
          const waitMs = retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS;
          setRetryReady(false);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (!cancelled) setRetryReady(true);
          }, waitMs);
        }
        setLoading(false);
      },
    );
    onCleanup(() => {
      cancelled = true;
      clearRetryTimer();
    });
  });

  const isUnauthorized = () => isBrokerAuthKind(error()?.kind);
  const isRateLimited = () => error()?.kind === "rate_limited";
  const errorKind = () =>
    isUnauthorized() ? "auth" : isRateLimited() ? "rate_limited" : "upstream";
  const retryWaitSeconds = () =>
    Math.ceil((error()?.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS) / 1000);
  const isRetryGated = () => isRateLimited() && !retryReady();

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
        <Box
          data-testid="positioning-error"
          data-kind={errorKind()}
          role="alert"
          className="flex flex-col gap-[64px]"
        >
          <Show
            when={isUnauthorized()}
            fallback={
              <Text size="sm" className="text-fin-negative">
                {isRateLimited()
                  ? `Rate limited by the options service · retry in ${retryWaitSeconds()}s`
                  : error()?.message}
              </Text>
            }
          >
            <BrokerAuthNotice connectTestId="positioning-connect" size="sm" />
          </Show>
          <Box>
            <Button
              size="sm"
              onClick={retry}
              disabled={isRetryGated()}
              data-testid="positioning-retry"
            >
              {isRetryGated() ? `Retry in ${retryWaitSeconds()}s` : "Retry"}
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
