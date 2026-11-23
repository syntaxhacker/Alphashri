import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  ActionIcon, Alert, Badge, Box, Button, Paper, Select, Slider, Tab, Tabs, TabsList, TabsPanel, Text,
  ToolbarRow, useMediaQuery,
} from "@/ui";
import { showNotification } from "@/ui/notifications";
import { CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyState, InlineLoader } from "@/components/common/states";
import { PayoffHeatmap } from "@/components/options/PayoffHeatmap";
import { PayoffTable } from "@/components/options/PayoffTable";
import { PayoffWorkbench } from "@/components/options/PayoffWorkbench";
import { formatExpiryLabel } from "@/components/options/payoffHeatmapOption";
import { createECharts } from "../report/echartsSolid";
import {
  fetchReplayFrames,
  placeOptionPaperOrder,
  previewOptionPaperOrder,
} from "@/api/optionsPaper";
import {
  getOptionsPaperState,
  setPendingOrder,
  setReplay,
  setReplayError,
  setReplayLoading,
  upsertPosition,
} from "@/state/optionsPaper";
import { optionsDockState } from "@/state/optionsDock";
import type { OptionPaperOrderRequest, OptionReplayResult, ReplayFrame } from "@/types/optionsPaper";
import { optionsReplayViewAt, payoffAtSpot } from "@/utils/optionsReplayView";
import * as palette from "@/ui/palette";
import { pathChartOption } from "./replayCharts";
import { reducedMotionClass, transitionClass } from "./replayMotion";

export interface ReplayPanelProps {
  positionId?: number | null;
  /** Route hints so a deep link still identifies the structure in the header. */
  hintUnderlying?: string;
  hintExpiry?: string;
  onCommitted?: (id: number) => void;
}

const SPEEDS = [1, 5, 15, 60];

function tone(value: number): string {
  return value > 0 ? palette.POSITIVE : value < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

type ViewTab = "table" | "matrix" | "path" | "payoff";

const RANGE_STEPS = [5, 8, 12, 20] as const;
const DEFAULT_RANGE_INDEX = 1;

/**
 * The dense table's bottom strip uses trading-desk labels; translate them to
 * the replay workstation's chart tabs instead of inventing a second tab set.
 */
function bottomViewToTab(view: string): ViewTab {
  const key = view.toLowerCase().replace(/[\s_\-./%$]+/g, "");
  if (key.includes("table")) return "table";
  if (key.includes("graph")) return "matrix";
  if (key.includes("contractvalue") || key.includes("maxrisk")) return "payoff";
  if (key.includes("pnl")) return "path";
  return "table";
}

/** Accept both a step index (0-3) and a percentage (5/8/12/20, or 0.08). */
function rangeValueToIndex(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value) && value >= 0 && value < RANGE_STEPS.length) return value;
  const pct = value > 0 && value <= 1 ? value * 100 : value;
  let best = 0;
  for (let i = 1; i < RANGE_STEPS.length; i += 1) {
    if (Math.abs(RANGE_STEPS[i] - pct) < Math.abs(RANGE_STEPS[best] - pct)) best = i;
  }
  return best;
}

/** Explanations travel with every placeholder, so a bare "—" never stands alone. */
const NO_PAYOFF_NOTE = "No payoff curve — no priced frames were returned.";

/**
 * Transport/parser messages are kept out of the primary alert copy. They stay
 * available as a native tooltip on the message and in a collapsed detail line.
 */
const LOAD_ERROR_COPY =
  "Couldn't load this replay. The recorded frames aren't available right now — reopen the structure from the Options Dock and try again.";
const COMMIT_ERROR_COPY =
  "Couldn't commit this structure to the paper book. No order was placed — try again.";
const CHART_ERROR_COPY =
  "The P&L chart couldn't be drawn. The payoff figures below are still current.";

interface MatrixExpiry {
  date: string;
  label: string;
  projected: boolean;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return day <= daysInMonth ? day : day - 7;
}

/**
 * Monthly expiries keep the source expiry's weekday and ordinal (e.g. the third
 * Friday) for the next three months. These are calendar projections only — no
 * premium, IV or price is ever invented from them.
 */
export function projectedMonthlyExpiries(iso: string | null, count = 3): MatrixExpiry[] {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return [];
  const base = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return [];
  const weekday = base.getUTCDay();
  const ordinal = Math.floor((base.getUTCDate() - 1) / 7) + 1;
  const out: MatrixExpiry[] = [];
  for (let i = 1; i <= count; i += 1) {
    const monthIndex = base.getUTCMonth() + i;
    const year = base.getUTCFullYear() + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const day = nthWeekdayOfMonth(year, month, weekday, ordinal);
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    out.push({ date, label: `${date} · projected`, projected: true });
  }
  return out;
}

function matrixExpiries(expiry: string | null, symbol?: string | null): MatrixExpiry[] {
  // The dock is app-wide and polls a live chain. Its expiries only describe the
  // replay structure when it holds that underlying; otherwise they are foreign
  // dates with no recorded chain for this payoff.
  const dockSymbol = optionsDockState.symbol;
  const matches = !dockSymbol || !symbol || dockSymbol.toUpperCase() === symbol.toUpperCase();
  const known = matches
    ? optionsDockState.expiries
        .filter((entry) => entry.date)
        .map((entry) => ({ date: entry.date, label: entry.date, projected: false }))
    : [];
  return known.length > 0 ? known : projectedMonthlyExpiries(expiry);
}

/**
 * The preview handed across the dock→replay navigation is cached in one global
 * slot. Underlying + expiry alone are not its identity: a different entry date
 * or a different leg set with the same expiry produces different frames.
 */
function samePreviewStructure(
  replay: OptionReplayResult,
  pending: OptionPaperOrderRequest | null,
): boolean {
  if (!pending || replay.frames.length === 0) return false;
  if (replay.underlying.toUpperCase() !== pending.underlying.toUpperCase()) return false;
  if (replay.expiry.slice(0, 10) !== pending.expiry.slice(0, 10)) return false;
  if ((replay.source === "replay") !== (pending.source === "replay")) return false;
  if (pending.source === "replay" && pending.entryTs) {
    const firstFrameDate = replay.frames[0].t.slice(0, 10);
    const entryDate = pending.entryTs.slice(0, 10);
    if (firstFrameDate && firstFrameDate !== entryDate) return false;
  }
  if (replay.legs.length !== pending.legs.length) return false;
  return replay.legs.every((leg, index) => {
    const input = pending.legs[index];
    return leg.action === input.action
      && leg.opt === input.opt
      && Number(leg.strike) === Number(input.strike)
      && leg.lots === input.lots;
  });
}

/** The replay window is one session; a future expiry clamps to the last frame. */
function frameIndexForExpiry(frames: readonly ReplayFrame[], expiry: string | null): number {
  if (frames.length === 0) return 0;
  if (expiry && /^\d{4}-\d{2}-\d{2}/.test(expiry)) {
    const day = expiry.slice(0, 10);
    const exact = frames.findIndex((frame) => frame.t.slice(0, 10) === day);
    if (exact >= 0) return exact;
    if (day < frames[0].t.slice(0, 10)) return 0;
    if (day > frames[frames.length - 1].t.slice(0, 10)) return frames.length - 1;
  }
  return frames.length - 1;
}

// CompactStat renders its value in a `<p>` flex child with the default
// `min-width:auto`; let that child shrink so a long figure never widens the
// stat card past its grid column. Values are never truncated — the KPI strip
// goes 2-up at 390px so the full number fits.
const STAT_VALUE_SHRINK = "[&>div>div:nth-child(2)>p]:min-w-0";

// The legs grid sits inside a bordered WorkstationPanel. CompactStatGrid's
// divide-x would stack a divider on top of that border, so neutralise it here
// instead of resting a full-contrast border on a full-contrast border.
const NO_DIVIDE = "[&>*]:border-l-0!";

/** Keeps the raw exception one gesture away without making it the headline. */
function ErrorDetail(props: { detail: string | null }) {
  return (
    <Show when={props.detail}>
      <details className="mt-1 text-[11px]">
        <summary className="cursor-pointer">Technical detail</summary>
        <Text span size="xs" c="dimmed" className="block break-words">
          {props.detail}
        </Text>
      </details>
    </Show>
  );
}

function PlayGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4v16l13 -8l-13 -8" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

function StatValue(props: { text: string; tooltip?: string }) {
  return (
    <Text
      span
      className="block w-full text-right font-mono tabular-nums"
      style={{ "font-size": "12px" }}
      title={props.tooltip ?? props.text}
    >
      {props.text}
    </Text>
  );
}

/**
 * One bordered section of the replay desk. Unlike CompactPanel its body is a
 * flex child with a definite zero min-height, so the ECharts cells actually
 * grow into the viewport instead of stopping at a fixed card height.
 */
function WorkstationPanel(props: {
  title: string;
  testId: string;
  children: JSX.Element;
  className?: string;
}) {
  return (
    <Paper
      data-testid={props.testId}
      className={`flex flex-col min-w-0 min-h-0 overflow-hidden rounded-fin border border-fin-border-default bg-fin-surface ${props.className ?? ""}`}
    >
      {/* Inset rules are intentionally fainter than the section's own boundary:
          a full-contrast rule here would read as a second border-on-border. */}
      <Box className="flex items-center shrink-0 min-w-0 py-3 px-2 border-b border-fin-border-subtle">
        <Text
          fw={700}
          className="uppercase truncate"
          title={props.title}
          style={{
            "font-size": "14px",
            "font-family": palette.MONO,
            "letter-spacing": "0.08em",
            "line-height": "1.2",
            color: "var(--color-fin-primary)",
          }}
        >
          {props.title}
        </Text>
      </Box>
      <Box className="flex flex-col flex-1 min-h-0 min-w-0 p-2 gap-2">
        {props.children}
      </Box>
    </Paper>
  );
}

export function ReplayPanel(props: ReplayPanelProps) {
  const [replayResult, setReplayResult] = createSignal<OptionReplayResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [storeError, setStoreError] = createSignal<string | null>(null);
  const [index, setIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(15);
  /** Raw transport detail; never rendered as the primary message. */
  const [localError, setLocalError] = createSignal<string | null>(null);
  const [commitBlocked, setCommitBlocked] = createSignal<string | null>(null);
  const [chartError, setChartError] = createSignal<string | null>(null);
  const [committedId, setCommittedId] = createSignal<number | null>(null);
  /** The dock stores ATM IV in vol points; the matrix model wants decimal vol. */
  const chainIv = (): number | null => {
    const recorded = getOptionsPaperState().pendingOrder?.atmIv;
    const dockSymbol = optionsDockState.symbol;
    const dockMatches = !dockSymbol || dockSymbol.toUpperCase() === symbolLabel().toUpperCase();
    // A live chain for another underlying (or a 0 IV meaning "no quote") must
    // never outrank the IV recorded with the preview.
    const candidates = dockMatches
      ? [optionsDockState.chain?.atmIv, recorded]
      : [recorded];
    return candidates.find((value) =>
      typeof value === "number" && Number.isFinite(value) && value > 0) ?? null;
  };
  const ivUnavailable = () => chainIv() === null;
  // The payoff workbench is the primary view: a dock-style payoff line plus a
  // KPI strip, reachable regardless of IV. The table/matrix/path panels stay as
  // secondary (ADVANCED) tabs. No IV no longer auto-selects a different tab.
  const [viewTab, setViewTab] = createSignal<ViewTab>("payoff");
  const [rangeIndex, setRangeIndex] = createSignal<number>(DEFAULT_RANGE_INDEX);
  const [selectedExpiry, setSelectedExpiry] = createSignal<string | null>(null);
  const [cellNote, setCellNote] = createSignal<string | null>(null);
  const isNarrow = useMediaQuery("(max-width: 639px)");
  const navigate = useNavigate();
  const pathChart = createECharts();

  const result = replayResult;
  const structure = () => result() ?? getOptionsPaperState().pendingOrder;
  const hasStructure = () => Boolean(structure()?.underlying);
  const symbolLabel = () =>
    structure()?.underlying || props.hintUnderlying || "NO STRUCTURE SELECTED";
  const expiryLabel = () => structure()?.expiry || props.hintExpiry || "";
  const frames = () => result()?.frames ?? [];
  const asOf = () => frames()[Math.min(index(), Math.max(0, frames().length - 1))]?.t ?? null;
  const view = createMemo(() => optionsReplayViewAt(result(), asOf()));
  const spot = () => view().current?.spot ?? 0;
  const expiryValue = () => payoffAtSpot(result(), spot());
  const gapCount = () => result()?.coverage.gaps ?? 0;
  /** A structure can load successfully while the frame builder returns nothing. */
  const missingFrames = () => result() !== null && frames().length === 0;
  const isCommitted = () => committedId() !== null || result()?.positionId != null;
  const statusColor = () => (isCommitted() ? "positive" : "warning");
  const footnote = () =>
    `Expiry payoff is intrinsic value at expiry (gross of costs). The path and P&L above are mark-to-market net of entry charges only. Entry costs ₹${result()!.summary.costs.toFixed(2)}.`;

  const expiries = createMemo(() => matrixExpiries(expiryLabel(), symbolLabel()));
  const rangePct = () => RANGE_STEPS[rangeIndex()];
  const ivDecimal = () => (chainIv() === null ? null : chainIv()! / 100);
  const matrixAsOf = () => asOf()?.slice(0, 10);
  const matrixLegs = () =>
    (result()?.legs ?? []).map((leg) => ({
      action: leg.action,
      opt: leg.opt,
      strike: leg.strike,
      premium: leg.entryPremium,
      qty: leg.qty,
    }));
  const matrixExpiryDates = () => expiries().map((entry) => entry.date);
  /** The workbench consumes stored legs directly, before the table/heatmap mapping. */
  const workbenchLegs = () =>
    (result()?.legs ?? []).map((leg) => ({
      action: leg.action,
      opt: leg.opt,
      strike: leg.strike,
      qty: leg.qty,
      entryPremium: leg.entryPremium,
    }));
  const projectedNote = () => expiries().some((entry) => entry.projected);
  const projectedLabels = () => expiries().filter((entry) => entry.projected).map((entry) => entry.label);

  const selectExpiry = (expiry: string) => {
    setSelectedExpiry(expiry);
  };

  const selectCell = (strike: number, expiry: string) => {
    setSelectedExpiry(expiry);
    const idx = frameIndexForExpiry(frames(), expiry);
    setPlaying(false);
    setIndex(idx);
    const isProjected = expiries().find((entry) => entry.date === expiry)?.projected;
    const message = `₹${strike} · ${expiry}${isProjected ? " (projected)" : ""} · playhead clamped to frame ${idx + 1}/${frames().length}.`;
    setCellNote(message);
    showNotification({ message, color: "info" });
  };

  const changeTableRange = (value: number) => {
    const next = rangeValueToIndex(value);
    if (next !== null) setRangeIndex(next);
  };

  const changeTableView = (view: string) => setViewTab(bottomViewToTab(view));

  onMount(() => {
    // The load writes to the same store it reads. A createEffect would cancel
    // its own in-flight request when those writes invalidate its subscription.
    const store = getOptionsPaperState();
    const pending = store.pendingOrder;
    const id = props.positionId;
    if (id == null && !pending) return;
    // `pending` is non-null here (the guard above returned otherwise), but TS
    // cannot correlate `id == null` with that narrowing across the two checks.
    if (id == null && store.replay && samePreviewStructure(store.replay, pending ?? null)) {
      setReplayResult(store.replay);
      setIndex(Math.max(0, store.replay.frames.length - 1));
      return;
    }
    let alive = true;
    setReplayLoading(true);
    setLoading(true);
    setReplayError(null);
    setStoreError(null);
    setLocalError(null);
    setCommitBlocked(null);
    const task = id != null
      ? fetchReplayFrames(id)
      : previewOptionPaperOrder({
          ...pending!,
          source: "replay",
          entryTs: pending!.entryTs ?? "2026-11-17T09:47:00+05:30",
        });
    task
      .then((next) => {
        if (!alive) return;
        setReplay(next);
        setReplayResult(next);
        setIndex(Math.max(0, next.frames.length - 1));
        setCommittedId(id ?? null);
        setPlaying(false);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const message = error instanceof Error ? error.message : String(error);
        setStoreError(message);
        setReplayError(message);
      })
      .finally(() => {
        if (alive) {
          setReplayLoading(false);
          setLoading(false);
        }
      });
    onCleanup(() => {
      alive = false;
    });
  });

  createEffect(() => {
    if (!playing() || frames().length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => {
        if (current >= frames().length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, Math.max(40, Math.round(600 / speed())));
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    const option = pathChartOption(result(), asOf());
    // The chart div is mounted by a <Show>; wait for that ref before init.
    queueMicrotask(() => {
      void pathChart.setChartOption(option).then(
        () => setChartError(null),
        (error: unknown) => setChartError(error instanceof Error ? error.message : String(error)),
      );
    });
  });

  const commit = async () => {
    const pending = getOptionsPaperState().pendingOrder;
    if (!pending) {
      setCommitBlocked("There is no pending structure to commit.");
      return;
    }
    setCommitBlocked(null);
    setLocalError(null);
    setReplayLoading(true);
    try {
      const placed = await placeOptionPaperOrder({
        ...pending,
        source: "replay",
        entryTs: pending.entryTs ?? asOf() ?? undefined,
      });
      if (placed.position) {
        upsertPosition(placed.position);
        setCommittedId(placed.position.id);
        setPendingOrder(null);
        setLocalError(null);
        props.onCommitted?.(placed.position.id);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplayLoading(false);
    }
  };

  const errorDetail = () => localError() ?? storeError();
  const errorCopy = () =>
    commitBlocked() ?? (localError() ? COMMIT_ERROR_COPY : storeError() ? LOAD_ERROR_COPY : null);
  const skipped = () => result()?.skipped ?? null;

  // The playhead index flips the transform target; the CSS transition does the
  // rest. No timers, no text changes, no extra DOM nodes — tests read the same
  // <span>s they always did, and only transform/opacity ever animate.
  const playheadMotion = () =>
    `${transitionClass("playhead")} ${reducedMotionClass()} ${index() % 2 === 0 ? "-translate-y-px" : "translate-y-0"}`;
  const tileMotion = () =>
    `${transitionClass("tile")} ${reducedMotionClass()} ${index() % 2 === 0 ? "translate-y-0" : "-translate-y-px"}`;
  const panelMotion = () =>
    `${transitionClass("panel")} ${reducedMotionClass()} ${index() % 2 === 0 ? "opacity-100" : "opacity-95"}`;
  const stateMotion = () =>
    `${transitionClass("state")} ${reducedMotionClass()} ${isCommitted() ? "scale-100 opacity-100" : "scale-[0.98] opacity-95"}`;
  const buttonMotion = () => `${transitionClass("button")} ${reducedMotionClass()}`;

  return (
    <div className="h-full min-h-0 w-full flex flex-col gap-2 overflow-hidden" data-testid="options-replay-panel">
      <ToolbarRow gap={16} data-testid="replay-meta" className="shrink-0 min-h-6">
        <Badge
          size="xs"
          variant="outline"
          color={hasStructure() ? "primary" : "neutral"}
          className="truncate"
          title={`Underlying · ${symbolLabel()}`}
          data-testid="replay-symbol-chip"
        >
          {symbolLabel()}
        </Badge>
        <Show when={expiryLabel()}>
          <Badge size="xs" variant="outline" className="truncate" data-testid="replay-expiry-chip">
            {expiryLabel()}
          </Badge>
        </Show>
        <Show when={hasStructure()}>
          <Badge
            size="xs"
            variant="outline"
            color={statusColor()}
            className={`truncate ${stateMotion()}`}
            data-testid="replay-commit-badge"
          >
            {isCommitted() ? "COMMITTED · HOLD TO EXPIRY" : "PREVIEW"}
          </Badge>
          <Badge size="xs" variant="outline" data-testid="replay-source-badge">
            {result()?.source === "replay" ? "REPLAY" : "PAPER"}
          </Badge>
        </Show>
      </ToolbarRow>

      <Show when={errorCopy()}>
        <Alert color="error" data-testid="replay-error" className="shrink-0">
          <Text size="sm" title={errorDetail() ?? undefined}>{errorCopy()}</Text>
          <ErrorDetail detail={errorDetail()} />
        </Alert>
      </Show>
      <Show when={skipped()}>
        <Alert color="warning" data-testid="replay-skipped" className="shrink-0">
          {skipped()}
        </Alert>
      </Show>
      <Show when={chartError()}>
        <Alert color="error" data-testid="replay-chart-error" className="shrink-0">
          <Text size="sm" title={chartError() ?? undefined}>{CHART_ERROR_COPY}</Text>
          <ErrorDetail detail={chartError()} />
        </Alert>
      </Show>
      <Show when={isCommitted()}>
        <Text size="xs" c="positive" data-testid="replay-committed-note" className={`shrink-0 ${stateMotion()}`}>
          Position #{committedId() ?? result()!.positionId} is open in the paper book until expiry.
        </Text>
      </Show>
      <Show when={loading()}>
        <InlineLoader data-testid="replay-loading" />
      </Show>

      <Show
        when={result() && frames().length > 0}
        fallback={
          <Box className="flex-1 min-h-0 w-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 max-w-[420px] py-8">
              <EmptyState
                data-testid="replay-empty"
                title={missingFrames() ? "No replay frames" : "No replay to show"}
                description={missingFrames()
                  ? "The structure is loaded, but the replay returned no priced frames. Frames are built only from market data inside the selected session — try another expiry or re-run the scan."
                  : "Open a structure in the Options Dock, then choose Replay this structure to backdate its payoff and commit it to your paper book."}
                action={
                  <Button
                    size="sm"
                    variant="filled"
                    className={buttonMotion()}
                    data-testid="replay-open-dock"
                    onClick={() => navigate("/screener")}
                  >
                    Open Options Dock
                  </Button>
                }
              />
              <Show when={missingFrames()}>
                <Text size="xs" c="warning" data-testid="replay-missing-frames" className="shrink-0 text-center">
                  No frames were returned for this structure — no payoff path can be drawn until priced frames exist.
                </Text>
              </Show>
            </div>
          </Box>
        }
      >
        <div className="flex-1 min-h-0 w-full flex flex-col gap-3 overflow-y-auto">
          <WorkstationPanel title="PLAYBACK" testId="replay-playback" className="flex-1 min-h-[260px]">
            <ToolbarRow gap={8} data-testid="replay-controls" className="shrink-0">
              <ActionIcon
                size="sm"
                variant="light"
                color="primary"
                data-testid="replay-play"
                className={buttonMotion()}
                aria-label={playing() ? "Pause replay" : "Play replay"}
                title={playing() ? "Pause replay (Space)" : "Play replay (Space)"}
                onClick={() => {
                  if (!playing() && index() >= frames().length - 1) setIndex(0);
                  setPlaying(!playing());
                }}
              >
                <Show when={playing()} fallback={<PlayGlyph />}>
                  <PauseGlyph />
                </Show>
              </ActionIcon>
              <Select
                data-testid="replay-speed"
                size="xs"
                w={84}
                value={String(speed())}
                onChange={(value) => value && setSpeed(Number(value))}
                data={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))}
                aria-label="Replay speed"
              />
              <Box className="min-w-20 flex-1">
                <Slider
                  testId="replay-scrubber"
                  label="Replay playhead"
                  min={0}
                  max={Math.max(0, frames().length - 1)}
                  step={1}
                  value={index()}
                  onChange={(value) => {
                    setPlaying(false);
                    setIndex(value);
                  }}
                  formatValue={(value) =>
                    `Frame ${Math.min(value + 1, frames().length)} of ${frames().length} at ${frames()[value]?.t ?? "no priced frame"}`
                  }
                />
              </Box>
              <Text
                size="xs"
                className={`font-mono tabular-nums shrink-0 ${playheadMotion()}`}
                data-testid="replay-clock"
              >
                {asOf() ? asOf()!.replace("T", " ").slice(0, 16) : "no priced frame"}
              </Text>
              <Show when={!isNarrow()}>
                <Badge
                  size="xs"
                  variant="outline"
                  color="warning"
                  className={`shrink-0 ${playheadMotion()}`}
                  data-testid="replay-playhead"
                >
                  PLAYHEAD
                </Badge>
              </Show>
            </ToolbarRow>

            <Show when={gapCount() > 0 || view().priced === false}>
              <Text size="xs" c="warning" data-testid="replay-gaps" className="shrink-0">
                {gapCount() > 0
                  ? `${gapCount()} unpriced minute(s) skipped — the last known premium is carried, never invented.`
                  : "This frame is unpriced — the last known premium is carried, never invented."}
              </Text>
            </Show>

            <Show when={ivUnavailable()}>
              <Alert color="warning" data-testid="replay-iv-banner" className="shrink-0">
                No IV quote in the recorded chain — payoff shows intrinsic P&L only.
              </Alert>
            </Show>

            {/* Range and IV controls are shared by the workbench, table and heatmap
                so a single pair of testids moves every payoff view together. */}
            <ToolbarRow gap={8} className="shrink-0" data-testid="replay-range-controls">
              <Text size="xs" fw={700} className="uppercase shrink-0">SPOT RANGE / IV</Text>
              <Box className="w-28 shrink-0" title={`Spot range ±${rangePct()}%`}>
                <Slider
                  testId="replay-range-slider"
                  label="Payoff matrix spot range"
                  min={0}
                  max={RANGE_STEPS.length - 1}
                  step={1}
                  value={rangeIndex()}
                  onChange={(value) => {
                    if (Number.isInteger(value) && value >= 0 && value < RANGE_STEPS.length) setRangeIndex(value);
                  }}
                  formatValue={(value) => `Plus minus ${RANGE_STEPS[value] ?? rangePct()} percent spot range`}
                />
              </Box>
              <Text size="xs" className="font-mono tabular-nums shrink-0" data-testid="replay-range-label">
                ±{rangePct()}%
              </Text>
              <Text size="xs" className="font-mono tabular-nums shrink-0" data-testid="replay-iv-readout">
                {chainIv() === null ? "IV unavailable" : `${chainIv()!.toFixed(2)}% IV`}
              </Text>
              <Show when={ivUnavailable()}>
                <Badge size="xs" variant="outline" color="warning" data-testid="replay-table-intrinsic-badge">
                  INTRINSIC ONLY
                </Badge>
              </Show>
            </ToolbarRow>

            <Tabs
              value={viewTab()}
              onChange={(value) => {
                if (value === "table" || value === "matrix" || value === "path" || value === "payoff") setViewTab(value);
              }}
              className="flex-1 min-h-[560px] lg:min-h-0"
              data-testid="replay-view-tabs"
            >
              <TabsList
                className="shrink-0 overflow-x-auto"
                data-testid="replay-view-tablist"
                style={{ "border-bottom-color": "var(--color-fin-border-subtle)" }}
              >
                <Tab value="payoff" data-testid="replay-view-tab-payoff" className="shrink-0 whitespace-nowrap">
                  {isNarrow() ? "PAYOFF" : "EXPIRY PAYOFF"}
                </Tab>
                <Tab value="path" data-testid="replay-view-tab-path" className="shrink-0 whitespace-nowrap">
                  {isNarrow() ? "PATH" : "P&L PATH"}
                </Tab>
                <Tab value="table" data-testid="replay-view-tab-table" className="shrink-0 whitespace-nowrap">
                  {isNarrow() ? "TABLE" : `ADVANCED · TABLE${ivUnavailable() ? " · INTRINSIC ONLY" : ""}`}
                </Tab>
                <Tab value="matrix" data-testid="replay-view-tab-matrix" className="shrink-0 whitespace-nowrap">
                  {isNarrow() ? "MATRIX" : `ADVANCED · PAYOFF MATRIX${ivUnavailable() ? " · INTRINSIC ONLY" : ""}`}
                </Tab>
              </TabsList>

              <TabsPanel value="table" keepMounted className="flex-1 min-h-0" data-testid="replay-table-panel">
                <div className="flex flex-col h-full min-h-[240px] min-w-0">
                  {/* The payoff grid has a natural floor wider than 390px; give it a
                      scroll container instead of letting columns clip. */}
                  <div
                    role="region"
                    aria-label="Payoff table, scroll sideways for more strikes"
                    data-testid="replay-table-scroll"
                    className="flex-1 min-h-0 w-full overflow-x-auto overflow-y-hidden"
                  >
                    <div className="h-full min-w-[520px]">
                      <PayoffTable
                        legs={matrixLegs()}
                        spot={spot()}
                        iv={ivDecimal()}
                        rangePct={rangePct() / 100}
                        asOf={matrixAsOf()}
                        onSelectCell={selectCell}
                        onRangeChange={changeTableRange}
                        onViewChange={changeTableView}
                        testIdPrefix="replay-table"
                      />
                    </div>
                  </div>
                  <Show when={isNarrow()}>
                    <Text size="xs" c="dimmed" data-testid="replay-table-scroll-hint" className="shrink-0">
                      Scroll sideways to see more strikes.
                    </Text>
                  </Show>
                </div>
              </TabsPanel>

              <TabsPanel value="matrix" keepMounted className="flex-1 min-h-0" data-testid="replay-matrix-panel">
                <div className="flex flex-col h-full min-h-[240px] min-w-0 gap-2">
                  <Text size="xs" c="dimmed" data-testid="replay-keyboard-hint" className="shrink-0">
                    Keyboard: arrow keys move the heatmap cell cursor, Enter selects and moves the playhead to that expiry.
                  </Text>
                  <div className="flex-1 min-h-[240px] min-w-0 mb-4">
                    <PayoffHeatmap
                      legs={matrixLegs()}
                      spot={spot()}
                      expiries={matrixExpiryDates()}
                      iv={ivDecimal()}
                      rangePct={rangePct() / 100}
                      asOf={matrixAsOf()}
                      selectedExpiry={
                        selectedExpiry()
                          ? formatExpiryLabel(selectedExpiry()!, matrixAsOf())
                          : undefined
                      }
                      onSelectExpiry={selectExpiry}
                      onSelectCell={selectCell}
                      height={280}
                      testIdPrefix="replay-matrix"
                    />
                  </div>
                </div>
              </TabsPanel>

              <div
                className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0 w-full"
                style={{
                  display: viewTab() === "path" || viewTab() === "payoff" ? "grid" : "none",
                  "min-height": "240px",
                }}
                data-testid="replay-charts-grid"
              >
                <TabsPanel value="path" keepMounted className="min-h-0" data-testid="replay-path-panel">
                  <div className="flex flex-col min-w-0 min-h-0 h-full">
                    <Text size="xs" fw={700} className="uppercase shrink-0">P&L PATH</Text>
                    <div
                      ref={pathChart.ref}
                      data-testid="replay-path-chart"
                      className={`w-full min-w-0 flex-1 min-h-[240px] ${panelMotion()}`}
                    />
                  </div>
                </TabsPanel>
                <TabsPanel value="payoff" keepMounted className="min-h-0" data-testid="replay-payoff-panel">
                  <div className={`flex flex-col min-w-0 min-h-0 h-full ${panelMotion()}`}>
                    <Text size="xs" fw={700} className="uppercase shrink-0">EXPIRY PAYOFF</Text>
                    <PayoffWorkbench
                      legs={workbenchLegs()}
                      spot={spot()}
                      ivVolPoints={chainIv()}
                      asOf={asOf() ?? ""}
                      expiry={expiryLabel()}
                      rangePct={rangePct()}
                      dataTestId="replay-payoff-workbench"
                    />
                  </div>
                </TabsPanel>
              </div>
            </Tabs>

            {/* Shared across the table and heatmap: a click on either surface
                announces through the same live region. */}
            <Show when={cellNote()}>
              <div role="status" aria-live="polite" className="shrink-0 min-w-0">
                <Text size="xs" c="info" data-testid="replay-cell-note" className="shrink-0 truncate mt-2" title={cellNote()!}>
                  {cellNote()}
                </Text>
              </div>
            </Show>
            <Show when={projectedNote()}>
              <Text size="xs" c="dimmed" data-testid="replay-projected-note" className="shrink-0 mt-4">
                Projected expiries ({projectedLabels().join(", ")}) keep the structure's weekday; no prices are inferred.
              </Text>
            </Show>

            <Text size="xs" c="dimmed" className="shrink-0 truncate" title={footnote()}>
              {footnote()}
            </Text>
          </WorkstationPanel>

          <div className="w-full shrink-0">
            <CompactStatGrid cols={isNarrow() ? 2 : 4} spacing={8} className={NO_DIVIDE}>
              <CompactStat dense label="Realized" value={<StatValue text={signed(view().realized)} />} className={`${tileMotion()} ${STAT_VALUE_SHRINK}`} data-testid="replay-realized" />
              <CompactStat dense label="Unrealized" value={<StatValue text={signed(view().unrealized)} />} tone={tone(view().unrealized)} className={`${tileMotion()} ${STAT_VALUE_SHRINK}`} data-testid="replay-unrealized" />
              <CompactStat dense label="Total" value={<StatValue text={signed(view().total)} />} tone={tone(view().total)} className={`${tileMotion()} ${STAT_VALUE_SHRINK}`} data-testid="replay-total" />
              <CompactStat dense label="Payoff at spot" value={<StatValue text={expiryValue() === null ? "—" : signed(expiryValue()!)} tooltip={expiryValue() === null ? NO_PAYOFF_NOTE : undefined} />} className={`${tileMotion()} ${STAT_VALUE_SHRINK}`} data-testid="replay-payoff-at-spot" />
            </CompactStatGrid>
          </div>

          <WorkstationPanel title="LEGS AT PLAYHEAD" testId="replay-legs" className="shrink-0">
            <CompactStatGrid cols={isNarrow() ? 2 : 4} spacing={8} className={NO_DIVIDE}>
              <For each={result()!.legs}>
                {(leg) => {
                  const key = `${String(leg.strike)}-${leg.opt}`;
                  const mark = () => view().current?.marks[key] ?? leg.entryPremium;
                  const pnl = () =>
                    (leg.action === "BUY" ? 1 : -1) *
                    (mark() - leg.entryPremium) * Number(leg.qty);
                  return (
                    <CompactStat
                      dense
                      label={`${leg.action} ${leg.strike} ${leg.opt} ×${leg.lots}`}
                      value={<StatValue text={`${leg.entryPremium.toFixed(2)} → ${mark().toFixed(2)} · ${signed(pnl())}`} />}
                      tone={tone(pnl())}
                      className={`${tileMotion()} ${STAT_VALUE_SHRINK}`}
                    />
                  );
                }}
              </For>
            </CompactStatGrid>
          </WorkstationPanel>

          <ToolbarRow justify="flex-end" gap={16} data-testid="replay-actions" className="shrink-0">
            <Show when={!isCommitted()}>
              <Button size="sm" className={buttonMotion()} data-testid="replay-commit" onClick={() => void commit()} disabled={loading()}>
                COMMIT TO PAPER BOOK
              </Button>
            </Show>
          </ToolbarRow>
        </div>
      </Show>
    </div>
  );
}

export default ReplayPanel;
