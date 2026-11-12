import { memo, useMemo } from "react";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyReplay } from "@/types/niftyReport";
import type { ReplayCoverage } from "./niftyReplayCoverage";
import {
  SESSION_END_MIN,
  SESSION_START_MIN,
  coverageTone,
  minuteLabel,
  minuteOfDay,
} from "./niftyReplayCoverage";

/** A replay frame timestamp as a wall-clock "HH:MM" label (e.g. "10:31").
 *  Accepts ISO instants ("2026-10-10T10:31:00+05:30") and bare "10:31". */
export function replayTimeLabel(t: string): string {
  const m = /(?:^|[T ])(\d{2}:\d{2})/.exec(t);
  return m ? m[1] : t;
}

/** Human labels for the recorder's skip reasons (the gap journal). */
const REPLAY_REASON_LABEL: Record<string, string> = {
  chainFailed: "chain fetch failed",
  timeout: "tick timed out",
  spotRejected: "spot rejected",
  emptyChain: "empty chain",
  loopError: "loop error",
};

export interface ReplayReason {
  reason: string;
  n: number;
  label: string;
}

export function toReplayReasons(
  gapReasons: Record<string, number> | undefined,
): ReplayReason[] {
  if (!gapReasons) return [];
  return Object.entries(gapReasons)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => ({
      reason,
      n,
      label: REPLAY_REASON_LABEL[reason] ?? reason,
    }));
}

interface ReplaySegment {
  key: string;
  minutes: number;
  missing: boolean;
}

/**
 * Timeline segments in frame order: one minute per frame, plus a segment as
 * wide as the hole it skips. Leading/trailing holes cover the rest of the
 * session, so the strip always spans 09:15–15:39.
 */
export function buildReplaySegments(
  replay: NiftyReplay | null,
  coverage: ReplayCoverage | null,
): ReplaySegment[] {
  if (!replay) return [];
  const segs: ReplaySegment[] = [];
  const firstMin = minuteOfDay(replay.snapshots[0]?.t ?? "");
  if (firstMin !== null && firstMin > SESSION_START_MIN) {
    segs.push({ key: "lead", minutes: firstMin - SESSION_START_MIN, missing: true });
  }
  replay.snapshots.forEach((_, i) => {
    segs.push({ key: `f${i}`, minutes: 1, missing: false });
    const skipped = coverage?.stepMissing[i] ?? 0;
    if (skipped > 0) segs.push({ key: `g${i}`, minutes: skipped, missing: true });
  });
  const lastMin = minuteOfDay(replay.snapshots[replay.snapshots.length - 1]?.t ?? "");
  if (lastMin !== null && lastMin < SESSION_END_MIN) {
    segs.push({ key: "tail", minutes: SESSION_END_MIN - lastMin, missing: true });
  }
  return segs;
}

/** In-session holes only (keys `gN`) — the lead-in and tail are the recorder
 *  starting late / stopping early, not missed ticks. */
export function countReplayHoles(segments: ReplaySegment[]): number {
  return segments.filter((s) => s.key.startsWith("g")).length;
}

/** The coverage strip: ~250-380 inline segment boxes. Memoised on the segment
 *  list so unrelated parent renders never rebuild the boxes. */
const ReplayCoverageStrip = memo(function ReplayCoverageStrip({
  segments,
  title,
}: {
  segments: ReplaySegment[];
  title: string | undefined;
}) {
  return (
    <Box
      data-testid="nifty-replay-coverage-strip"
      title={title}
      className="flex overflow-hidden rounded-[0.75px]"
      style={{ height: "6px", backgroundColor: palette.TERM_BORDER }}
    >
      {segments.map((s) => (
        <Box
          key={s.key}
          className="min-w-0"
          style={{
            flexGrow: s.minutes,
            flexBasis: 0,
            backgroundColor: s.missing ? palette.NEGATIVE : palette.PRIMARY,
            opacity: s.missing ? 0.45 : 0.9,
          }}
        />
      ))}
    </Box>
  );
});

interface NiftyReplayBarProps {
  replay: NiftyReplay;
  replayIndex: number;
  playing: boolean;
  coverage: ReplayCoverage | null;
  reasons: ReplayReason[];
  holes: number;
  onScrub: (index: number) => void;
  onTogglePlay: () => void;
}

/**
 * EOD minute replay bar, isolated behind `React.memo`. All props are stable
 * across unrelated parent renders (`coverage`/`reasons`/`holes` are memoised
 * in the parent; callbacks are `useCallback`), so tick/stream pushes never
 * rebuild the ~250-380 segment boxes.
 */
export const NiftyReplayBar = memo(function NiftyReplayBar({
  replay,
  replayIndex,
  playing,
  coverage,
  reasons,
  holes,
  onScrub,
  onTogglePlay,
}: NiftyReplayBarProps) {
  const segments = useMemo(
    () => buildReplaySegments(replay, coverage),
    [replay, coverage],
  );

  const stripTitle = coverage
    ? `Recorded ${coverage.recorded}/${coverage.sessionMinutes} min` +
      ` · ${coverage.missing} min missing` +
      (coverage.largestGap
        ? ` · largest gap ${coverage.largestGap.minutes} min` +
          ` (${minuteLabel(coverage.largestGap.start)}–${minuteLabel(
            coverage.largestGap.end,
          )})`
        : "")
    : undefined;

  const tone = coverage ? coverageTone(coverage.pct) : "bad";
  const toneColor =
    tone === "good"
      ? palette.POSITIVE
      : tone === "warn"
        ? palette.WARNING
        : palette.NEGATIVE;

  const coverageTitle = coverage
    ? `${coverage.missing} of ${coverage.sessionMinutes} session minutes are missing` +
      (reasons.length > 0
        ? ` — ${reasons.map((r) => `${r.label} ×${r.n}`).join(", ")}`
        : "")
    : undefined;

  const reasonsTitle =
    reasons.length > 0
      ? `Why minutes are missing — the recorder's own skip reasons: ${reasons
          .map((r) => `${r.label} ×${r.n}`)
          .join(" · ")}`
      : `In-session holes are ticks that produced no row — ${holes} in-session hole${holes === 1 ? "" : "s"}, reason not logged.`;

  // Meta is `time · %` only: the cumulative hole/error counts live in the
  // tooltips (bar, coverage badge, reasons glyph), never in the bar itself.
  const reasonCounts = reasons.map((r) => `${r.label} ×${r.n}`).join(" · ");
  const barTitle = [
    coverage
      ? `Recorded ${coverage.recorded}/${coverage.sessionMinutes} min · ${coverage.missing} min missing`
      : null,
    reasonCounts || (holes > 0 ? `${holes} in-session hole${holes === 1 ? "" : "s"}` : null),
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <Box
      data-testid="nifty-replay-bar"
      title={barTitle || undefined}
      className="flex items-center gap-4 whitespace-nowrap w-full max-w-full min-w-0 shrink-0 overflow-hidden"
      style={{
        height: "24px",
        borderTop: `1px solid ${palette.TERM_BORDER}`,
        paddingLeft: "8px",
        paddingRight: "8px",
        paddingTop: 0,
        paddingBottom: 0,
      }}
    >
      <Button
        data-testid="nifty-replay-play"
        size="xs"
        variant="outline"
        onClick={onTogglePlay}
      >
        {playing ? "Pause" : "Play"}
      </Button>
      {/* Timeline: recorded minutes in blue, holes in red, so the size
          and position of every gap is visible before playback jumps it. */}
      <Box className="flex flex-col" style={{ flex: 1, minWidth: "160px", gap: "3px" }}>
        <ReplayCoverageStrip segments={segments} title={stripTitle} />
        <Box
          component="input"
          type="range"
          data-testid="nifty-replay-slider"
          aria-label="Replay minute"
          min={0}
          max={replay.snapshots.length - 1}
          step={1}
          value={replayIndex}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="w-full"
          style={{ height: "12px", accentColor: palette.PRIMARY }}
        />
      </Box>
      <Text
        data-testid="nifty-replay-time"
        size="xs"
        c="dimmed"
        fw={600}
        span
        style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {replayTimeLabel(replay.snapshots[replayIndex]?.t ?? "")}
      </Text>
      {coverage && (
        <>
          <Text size="xs" span c="dimmed" style={{ flexShrink: 0 }} aria-hidden>
            ·
          </Text>
          <Text
            data-testid="nifty-replay-coverage"
            size="xs"
            span
            fw={600}
            title={coverageTitle}
            style={{ color: toneColor, whiteSpace: "nowrap", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
          >
            {coverage.pct}% · {coverage.recorded}/{coverage.sessionMinutes}
          </Text>
        </>
      )}
      {coverage && (coverage.stepMissing[replayIndex] ?? 0) > 0 && (
        <Text
          data-testid="nifty-replay-gap"
          size="xs"
          span
          title={`${coverage.stepMissing[replayIndex]} minutes skipped before this frame`}
          style={{ color: palette.WARNING, whiteSpace: "nowrap", flexShrink: 0 }}
        >
          +{coverage.stepMissing[replayIndex]}m
        </Text>
      )}
      <Text
        data-testid="nifty-replay-count"
        size="xs"
        span
        c="dimmed"
        style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {replayIndex + 1}/{replay.snapshots.length}
      </Text>
      {(reasons.length > 0 || holes > 0) && (
        <Text
          data-testid="nifty-replay-reasons"
          size="xs"
          span
          c="dimmed"
          title={reasonsTitle}
          aria-label={reasonsTitle}
          style={{
            whiteSpace: "nowrap",
            flexShrink: 0,
            cursor: "help",
            fontSize: "9px",
            opacity: 0.72,
          }}
        >
          ⓘ
        </Text>
      )}
    </Box>
  );
});
