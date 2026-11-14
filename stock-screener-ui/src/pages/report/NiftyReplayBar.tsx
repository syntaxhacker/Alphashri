import { createMemo, For, Show } from "solid-js";
import { Button, Text } from "@/ui";
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

/** Human labels for the recorder's skip reasons (the gap journal). Keys are
 *  kebab-case as journalled by the backend; camelCase aliases cover journals
 *  written by older builds. */
const REPLAY_REASON_LABEL: Record<string, string> = {
  "chain-failed": "chain fetch failed",
  "spot-rejected": "spot rejected",
  "empty-chain": "empty chain",
  "loop-error": "loop error",
  chainFailed: "chain fetch failed",
  spotRejected: "spot rejected",
  emptyChain: "empty chain",
  loopError: "loop error",
  timeout: "tick timed out",
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
 *  list so unrelated parent updates never rebuild the boxes. */
function ReplayCoverageStrip(props: {
  segments: ReplaySegment[];
  title: string | undefined;
}) {
  return (
    <div
      data-testid="nifty-replay-coverage-strip"
      title={props.title}
      class="flex overflow-hidden rounded-[0.75px]"
      style={{ height: "6px", "background-color": palette.TERM_BORDER }}
    >
      <For each={props.segments}>{(s) => (
        <div
          class="min-w-0"
          style={{
            "flex-grow": String(s.minutes),
            "flex-basis": "0",
            "background-color": s.missing ? palette.NEGATIVE : palette.PRIMARY,
            opacity: s.missing ? 0.45 : 0.9,
          }}
        />
      )}</For>
    </div>
  );
}

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
 * EOD minute replay bar. All props are stable across unrelated parent
 * updates, so tick/stream pushes never rebuild the ~250-380 segment boxes.
 */
export function NiftyReplayBar(props: NiftyReplayBarProps) {
  const replay = () => props.replay;
  const replayIndex = () => props.replayIndex;
  const segments = createMemo(() => buildReplaySegments(replay(), props.coverage));

  const stripTitle = () => {
    const coverage = props.coverage;
    return coverage
      ? `Recorded ${coverage.recorded}/${coverage.sessionMinutes} min` +
        ` · ${coverage.missing} min missing` +
        (coverage.largestGap
          ? ` · largest gap ${coverage.largestGap.minutes} min` +
            ` (${minuteLabel(coverage.largestGap.start)}–${minuteLabel(
              coverage.largestGap.end,
            )})`
          : "")
      : undefined;
  };

  const toneColor = () => {
    const coverage = props.coverage;
    const tone = coverage ? coverageTone(coverage.pct) : "bad";
    return tone === "good"
      ? palette.POSITIVE
      : tone === "warn"
        ? palette.WARNING
        : palette.NEGATIVE;
  };

  const coverageTitle = () => {
    const coverage = props.coverage;
    return coverage
      ? `${coverage.missing} of ${coverage.sessionMinutes} session minutes are missing` +
        (props.reasons.length > 0
          ? ` — ${props.reasons.map((r) => `${r.label} ×${r.n}`).join(", ")}`
          : "")
      : undefined;
  };

  const reasonsTitle = () =>
    props.reasons.length > 0
      ? `Why minutes are missing — the recorder's own skip reasons: ${props.reasons
          .map((r) => `${r.label} ×${r.n}`)
          .join(" · ")}`
      : `In-session holes are ticks that produced no row — ${props.holes} in-session hole${props.holes === 1 ? "" : "s"}, reason not logged.`;

  // Meta is `time · %` only: the cumulative hole/error counts live in the
  // tooltips (bar, coverage badge, reasons glyph), never in the bar itself.
  const barTitle = () => {
    const coverage = props.coverage;
    const reasonCounts = props.reasons.map((r) => `${r.label} ×${r.n}`).join(" · ");
    return [
      coverage
        ? `Recorded ${coverage.recorded}/${coverage.sessionMinutes} min · ${coverage.missing} min missing`
        : null,
      reasonCounts || (props.holes > 0 ? `${props.holes} in-session hole${props.holes === 1 ? "" : "s"}` : null),
    ]
      .filter(Boolean)
      .join(" — ");
  };

  const currentFrame = () => replay().snapshots[replayIndex()];

  return (
    <div
      data-testid="nifty-replay-bar"
      title={barTitle() || undefined}
      class="flex items-center gap-4 whitespace-nowrap w-full max-w-full min-w-0 shrink-0 overflow-hidden"
      style={{
        height: "24px",
        "border-top": `1px solid ${palette.TERM_BORDER}`,
        "padding-left": "8px",
        "padding-right": "8px",
        "padding-top": "0",
        "padding-bottom": "0",
      }}
    >
      <Button
        data-testid="nifty-replay-play"
        size="xs"
        variant="outline"
        onClick={props.onTogglePlay}
      >
        {props.playing ? "Pause" : "Play"}
      </Button>
      {/* Timeline: recorded minutes in blue, holes in red, so the size
          and position of every gap is visible before playback jumps it. */}
      <div class="flex flex-col" style={{ flex: "1", "min-width": "160px", gap: "3px" }}>
        <ReplayCoverageStrip segments={segments()} title={stripTitle()} />
        <input
          type="range"
          data-testid="nifty-replay-slider"
          aria-label="Replay minute"
          min={0}
          max={replay().snapshots.length - 1}
          step={1}
          value={replayIndex()}
          onChange={(e) => props.onScrub(Number(e.currentTarget.value))}
          class="w-full"
          style={{ height: "12px", "accent-color": palette.PRIMARY }}
        />
      </div>
      <Text
        data-testid="nifty-replay-time"
        size="xs"
        c="dimmed"
        fw={600}
        span
        style={{ "flex-shrink": "0", "font-variant-numeric": "tabular-nums" }}
      >
        {replayTimeLabel(currentFrame()?.t ?? "")}
      </Text>
      <Show when={props.coverage}>
        {(coverage) => (
          <>
            <Text size="xs" span c="dimmed" style={{ "flex-shrink": "0" }} aria-hidden="true">
              ·
            </Text>
            <Text
              data-testid="nifty-replay-coverage"
              size="xs"
              span
              fw={600}
              title={coverageTitle()}
              style={{ color: toneColor(), "white-space": "nowrap", "flex-shrink": "0", "font-variant-numeric": "tabular-nums" }}
            >
              {coverage().pct}% · {coverage().recorded}/{coverage().sessionMinutes}
            </Text>
          </>
        )}
      </Show>
      <Show when={props.coverage && (props.coverage.stepMissing[replayIndex()] ?? 0) > 0}>
        <Text
          data-testid="nifty-replay-gap"
          size="xs"
          span
          title={`${props.coverage!.stepMissing[replayIndex()]} minutes skipped before this frame`}
          style={{ color: palette.WARNING, "white-space": "nowrap", "flex-shrink": "0" }}
        >
          +{props.coverage!.stepMissing[replayIndex()]}m
        </Text>
      </Show>
      <Text
        data-testid="nifty-replay-count"
        size="xs"
        span
        c="dimmed"
        style={{ "flex-shrink": "0", "font-variant-numeric": "tabular-nums" }}
      >
        {replayIndex() + 1}/{replay().snapshots.length}
      </Text>
      <Show when={props.reasons.length > 0 || props.holes > 0}>
        <Text
          data-testid="nifty-replay-reasons"
          size="xs"
          span
          c="dimmed"
          title={reasonsTitle()}
          aria-label={reasonsTitle()}
          style={{
            "white-space": "nowrap",
            "flex-shrink": "0",
            cursor: "help",
            "font-size": "9px",
            opacity: 0.72,
          }}
        >
          ⓘ
        </Text>
      </Show>
    </div>
  );
}
