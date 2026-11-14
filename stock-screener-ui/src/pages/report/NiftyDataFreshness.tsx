import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { parseIstTimestampMs } from "./niftyDataFreshness";
import { computeNiftyFreshness, type FreshnessBurst, type NiftyFreshnessInput } from "./niftyFreshness";

interface NiftyDataFreshnessProps {
  report?: {
    fetchedAt?: string | null;
    market?: {
      is_open?: boolean | null;
      session_date?: string | null;
      as_of?: string | null;
    } | null;
  } | null;
  tape?: {
    date?: string | null;
    rows?: Array<{ t?: string | null }> | null;
  } | null;
  bursts?: FreshnessBurst[] | null;
  /** NSE cash session is open (a closed market is never "stale"). */
  marketOpen: boolean;
  sessionDate?: string | null;
}

/**
 * Small header status: `DATA 42s` while current, `STALE` in warning colour when
 * the tape is more than two minutes behind during market hours, or `CLOSED`
 * outside market hours. Owns its own 1s clock so the rest of the header never
 * re-renders to tick a badge.
 */
export function NiftyDataFreshness(props: NiftyDataFreshnessProps) {
  const [nowMs, setNowMs] = createSignal(Date.now());

  createEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    onCleanup(() => clearInterval(id));
  });

  // Compute the newest backend timestamp from report/tape/bursts
  const lastBackendMs = createMemo(() => {
    const effectiveSessionDate =
      props.sessionDate ?? props.report?.market?.session_date ?? props.tape?.date ?? null;

    const reportTs =
      parseIstTimestampMs(props.report?.market?.as_of, effectiveSessionDate) ??
      parseIstTimestampMs(props.report?.fetchedAt, effectiveSessionDate);

    let tapeTs: number | null = null;
    for (const row of props.tape?.rows ?? []) {
      const ts = parseIstTimestampMs(row?.t, effectiveSessionDate);
      if (ts !== null && (tapeTs === null || ts > tapeTs)) tapeTs = ts;
    }

    let burstTs: number | null = null;
    for (const b of props.bursts ?? []) {
      const ts = parseIstTimestampMs(b?.t, effectiveSessionDate);
      if (ts !== null && (burstTs === null || ts > burstTs)) burstTs = ts;
    }

    // Newest of all sources
    const candidates = [reportTs, tapeTs, burstTs].filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    return candidates.length > 0 ? Math.max(...candidates) : null;
  });

  const freshness = createMemo(() =>
    computeNiftyFreshness({
      nowMs: nowMs(),
      lastBackendMs: lastBackendMs(),
      marketOpen: props.marketOpen,
      bursts: props.bursts,
    } satisfies NiftyFreshnessInput),
  );

  return (
    <span
      data-testid="nifty-data-freshness"
      data-state={freshness().isStale ? "stale" : "fresh"}
      title={freshness().detail}
      class="inline-flex items-center shrink-0 whitespace-nowrap border rounded-full px-2 py-[2px] text-[11px]"
      style={{
        "border-color": freshness().isStale ? palette.WARNING : palette.TERM_BORDER,
        "color": freshness().isStale ? palette.WARNING : palette.TEXT_MUTED,
      }}
    >
      <Text size="xs" fw={freshness().isStale ? 700 : 600} c={freshness().isStale ? "warning" : "dimmed"} span>
        {freshness().label}
      </Text>
    </span>
  );
}
