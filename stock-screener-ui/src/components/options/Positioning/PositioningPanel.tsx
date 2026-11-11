import { useCallback, useEffect, useState } from "react";
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

export function PositioningPanel({ underlying, expiry }: PositioningPanelProps) {
  const [selUnderlying, setSelUnderlying] = useState(underlying);
  const [mode, setMode] = useState<PositioningMode>("since_open");
  const [view, setView] = useState<PositioningView>("table");
  const [data, setData] = useState<PositioningData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSelUnderlying(underlying);
  }, [underlying]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (!selUnderlying || !expiry) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getPositioning(selUnderlying, expiry, mode).then(
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
    return () => {
      cancelled = true;
    };
  }, [selUnderlying, expiry, mode, attempt]);

  const isUnauthorized = error?.status === 401;

  return (
    <Stack
      id="positioning-panel"
      data-testid="positioning-panel"
      spacing={1}
      className="flex flex-col w-full min-h-0 p-[16px]"
    >
      <PositioningHeader
        underlying={selUnderlying}
        onUnderlyingChange={setSelUnderlying}
        mode={mode}
        onModeChange={setMode}
        view={view}
        onViewChange={setView}
        timestamp={data?.timestamp}
      />

      {loading && (
        <Stack data-testid="positioning-loading" spacing={1}>
          <Skeleton h={64} radius="sm" />
          <Skeleton h={120} radius="sm" />
          <Skeleton h={200} radius="sm" />
        </Stack>
      )}

      {!loading && error && (
        <Box data-testid="positioning-error" className="flex flex-col gap-[64px]">
          <Text size="sm" className="text-fin-negative">
            {isUnauthorized
              ? "Upstox connection required to load positioning."
              : error.message}
          </Text>
          {isUnauthorized && (
            <Anchor href="/settings" data-testid="positioning-connect">
              Connect Upstox in Settings
            </Anchor>
          )}
          <Box>
            <Button size="sm" onClick={retry} data-testid="positioning-retry">
              Retry
            </Button>
          </Box>
        </Box>
      )}

      {!loading && !error && data && data.rows.length === 0 && (
        <EmptyState
          data-testid="positioning-empty"
          title="No positioning data"
          description="No strikes with readable positioning for this expiry."
        />
      )}

      {!loading && !error && data && data.rows.length > 0 && (
        <Stack spacing={2} className="flex flex-col">
          <VerdictBanner data={data} />
          <ReadingTable data={data} />
          {view === "table" ? (
            <PositioningStrikeTable rows={data.rows} />
          ) : (
            <PositioningChart rows={data.rows} />
          )}
        </Stack>
      )}
    </Stack>
  );
}
