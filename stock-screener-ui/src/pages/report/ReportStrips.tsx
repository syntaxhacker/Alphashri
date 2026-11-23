import { Show, createEffect, createMemo, createSignal } from "solid-js";

import type { WallsPayload } from "@/api/reportNifty";
import { Box, Button } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import { MarketAlertLog, MarketAlertStack } from "@/components/notifications/MarketAlertCard";

import { BreadthStrip, REPLAY_UNAVAILABLE_TEXT } from "./BreadthStrip";
import { LevelsInPlayContent } from "./LevelsInPlay";
import { Nifty10sStrip } from "./Nifty10sStrip";
import { NiftyDeskPlan } from "./NiftyDeskPlan";
import { NiftySqueezeRadar } from "./NiftySqueezeRadar";
import type { WallSnapshot } from "./NiftySqueezeRadar";
import { NiftyWallErosionBoard } from "./NiftyWallErosionBoard";
import { NiftyWallsCard } from "./NiftyWallsCard";
import { NiftyWallsExpanded } from "./NiftyWallsExpanded";
import { useNiftyReport } from "./ReportContext";
import { LiveTapeDisclosure } from "./reportBits";
import { oiBurstLogHeight } from "./reportCells";
import { REPORT_FONT } from "./reportTokens";
import { flowNoiseFor } from "./symbolMetrics";
import { OI_ALERT_TOAST_MAX } from "./useNiftyOiAlerts";

const EMPTY_WALL_HISTORY: WallSnapshot[] = [];

/** The unavailable-band treatment: one 24px reason line with Retry, the same
 *  chrome the replay surface gives its live-only bands. An empty band must not
 *  reserve a full card's height below the chart. */
function WallsUnavailableStrip(props: { onRetry?: () => void }) {
  return (
    <Box
      data-testid="nifty-walls-card"
      data-empty-kind="no-data"
      className="flex items-center gap-2 h-6 min-h-6 w-full min-w-0 shrink-0 px-2 bg-fin-surface font-mono text-ui-micro"
    >
      <span
        data-report-text="label"
        className="text-ui-micro font-extrabold uppercase tracking-[0.08em] text-fin-text-muted"
      >
        WALLS
      </span>
      <span data-report-text="value" className="text-ui-micro text-fin-text-muted">
        waiting for walls data…
      </span>
      <Show when={props.onRetry}>
        <Button
          data-testid="nifty-walls-retry"
          size="xs"
          variant="subtle"
          onClick={() => props.onRetry?.()}
          className="ml-auto min-w-0"
        >
          Retry
        </Button>
      </Show>
    </Box>
  );
}

export function ReportStrips() {
  const store = useNiftyReport();

  // Desk mode keeps the tape bands behind one row. Replay starts with the same
  // single collapsed heading: live-only bands have nothing to say there and a
  // row of empty strips was the original "looks worse than before" complaint.
  const report = () => store.data.report();
  const mode = () => store.selection.mode();
  const [tapeOpen, setTapeOpen] = createSignal(!store.ui.isDesk() && mode() === "live");
  createEffect(() => {
    setTapeOpen(!store.ui.isDesk() && mode() === "live");
  });
  const symbol = () => store.selection.symbol();
  const wallsPayload = () => store.walls.data();

  // A live recorder can hand back a truthy envelope with placeholder rows
  // before the chain has produced OI. That is no more a walls snapshot than
  // null: only a strike with positive open interest justifies the full card.
  const realWalls = createMemo((): WallsPayload | null => {
    const walls = wallsPayload();
    const hasOi = [...(walls?.calls ?? []), ...(walls?.puts ?? [])].some(
      (row) => (row.strike ?? 0) > 0 && (row.oi ?? 0) > 0,
    );
    return walls && hasOi ? walls : null;
  });

  const spotMove1m = createMemo(() => {
    const rows = store.data.tapeRows();
    if (!rows || rows.length < 2) return null;
    const last = rows[rows.length - 1]?.spot;
    const prev = rows[rows.length - 2]?.spot;
    return typeof last === "number" && typeof prev === "number" && last > 0 && prev > 0
      ? last - prev
      : null;
  });

  const replayAsOf = createMemo(() => {
    if (mode() !== "eod") return null;
    const frames = store.replay.replay()?.snapshots;
    if (!frames) return null;
    return frames[store.replay.index()]?.t ?? null;
  });

  const wallHistory = createMemo(() =>
    mode() === "live" ? store.walls.history() : EMPTY_WALL_HISTORY,
  );

  const flowNoise = createMemo(() => {
    const current = report();
    return current ? flowNoiseFor(current) : undefined;
  });

  let logRef: HTMLDivElement | undefined;

  const scrollToLog = () => {
    window.requestAnimationFrame(() => {
      logRef?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  return (
    <Box
      data-testid="nifty-report-strips"
      data-report-spacing="8"
      className="flex flex-col gap-2 w-full max-w-full min-w-0 shrink-0"
    >
      <LiveTapeDisclosure
        open={tapeOpen()}
        onToggle={() => setTapeOpen((v) => !v)}
        // Replay already names the reason once in its mode banner. The header
        // carries that one reason; no band repeats it inside the collapsed body.
        closedHint={mode() === "eod" ? `live-only · ${REPLAY_UNAVAILABLE_TEXT}` : undefined}
      >
        <Show when={mode() === "live"}>
          <BreadthStrip data={store.data.breadth()} />
        </Show>

        <Nifty10sStrip points={store.data.scorePoints()} noise={flowNoise()} />

        <Show when={!store.ui.isDesk()}>
          <Show when={report()}>
            {(current) => (
              <NiftySqueezeRadar
                report={current()}
                preMove={store.data.preMove()}
                setup={store.data.setup()}
                history={store.data.preMoveHistory()}
                wallHistory={wallHistory()}
                spotMove1m={spotMove1m()}
                metrics={store.data.metrics() ?? undefined}
                walls={wallsPayload()}
              />
            )}
          </Show>
        </Show>

        <NiftyWallErosionBoard
          walls={wallsPayload()}
          symbol={symbol()}
          asOf={replayAsOf()}
        />
      </LiveTapeDisclosure>

      {/* Only a snapshot with call/put levels mounts the full card. An empty or
          partial live envelope collapses to the one-line reason + Retry; replay
          already names that one reason in its mode banner, so no second line. */}
      <Show
        when={realWalls()}
        fallback={
          mode() === "live" ? (
            <WallsUnavailableStrip onRetry={() => store.data.refresh?.()} />
          ) : null
        }
      >
        {(walls) => (
          <NiftyWallsCard
            compact={store.ui.isDesk()}
            walls={walls()}
            onExpand={() => store.walls.openDrawer()}
            onOpenDesk={() => store.ui.setDeskOpen(true)}
            emptyText="Waiting for walls data."
            unavailableInReplay={mode() === "eod"}
            levels={
              symbol() === "NIFTY" ? (
                <LevelsInPlayContent report={report()} sensex={store.data.sensex()} />
              ) : undefined
            }
          />
        )}
      </Show>

      <NiftyWallsExpanded
        open={store.walls.open()}
        walls={wallsPayload()}
        onClose={() => store.walls.closeDrawer()}
        onReplayBreak={
          mode() === "eod" && store.replay.replay()
            ? (at) => store.replay.breakAt(at)
            : undefined
        }
      />

      <Show when={!store.ui.isDesk()}>
        <Show when={report()}>
          {(current) => <NiftyDeskPlan report={current()} />}
        </Show>
      </Show>

      <Show when={store.alerts.toasts().length > 0}>
        <Box
          data-testid="nifty-oi-toasts"
          className="w-full max-w-[620px] min-w-0 self-end shrink-0"
        >
          <MarketAlertStack
            alerts={store.alerts.toasts()}
            max={OI_ALERT_TOAST_MAX}
            onDismiss={(id) => store.alerts.dismissToast(id)}
            onOpen={() => scrollToLog()}
          />
        </Box>
      </Show>

      <Show when={store.alerts.trail().length > 0}>
        <Box
          ref={(el: HTMLDivElement) => {
            logRef = el;
          }}
          data-testid="nifty-oi-bursts-wrap"
          data-critical={store.alerts.criticalCount() > 0 ? "true" : undefined}
          className="min-w-0 shrink-0"
        >
          <CompactPanel
            flush
            title={
              <span
                data-report-text="title"
                style={{
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "8px",
                  "min-width": 0,
                  "font-size": `${REPORT_FONT.value}px`,
                  "line-height": 1.2,
                }}
              >
                <span>
                  OI bursts ({store.alerts.trail().length})
                  {store.ui.isDesk() && store.alerts.criticalCount() > 0
                    ? ` · critical ${store.alerts.criticalCount()}`
                    : ""}
                </span>
                <Show when={!store.ui.isDesk() && store.alerts.criticalCount() > 0}>
                  <Box
                    data-testid="nifty-oi-critical-badge"
                    title={`${store.alerts.criticalCount()} critical burst${store.alerts.criticalCount() === 1 ? "" : "s"} — filtered first`}
                    className="inline-flex items-center text-ui-micro font-bold tracking-[0.08em] text-fin-negative rounded-[3px] px-1 py-[1px] whitespace-nowrap nifty-critical-pulse"
                    style={{ "background-color": palette.TINT_NEGATIVE }}
                  >
                    CRITICAL {store.alerts.criticalCount()}
                  </Box>
                </Show>
              </span>
            }
            testId="nifty-oi-bursts-panel"
            action={
              <Box className="flex gap-2 items-center">
                <Button
                  data-testid="nifty-alert-sound-toggle"
                  size="sm"
                  variant="subtle"
                  onClick={() => store.alerts.toggleSound()}
                  className="min-w-[24px] px-1 text-ui-body leading-none"
                  {...{
                    "aria-pressed": !store.alerts.soundMuted(),
                    "aria-label": store.alerts.soundMuted()
                      ? "Unmute critical alert sound"
                      : "Mute critical alert sound",
                    title: store.alerts.soundMuted()
                      ? "Alert sounds off — click to enable the critical chirp"
                      : "Alert sounds on — critical bursts chirp and flash the tab title",
                  }}
                >
                  {store.alerts.soundMuted() ? "🔕" : "🔔"}
                </Button>
                <Show when={store.alerts.criticalCount() > 0}>
                  <Button
                    data-testid="nifty-oi-critical-filter"
                    size="sm"
                    variant="subtle"
                    onClick={() => store.alerts.toggleCriticalOnly()}
                    {...{ "aria-pressed": store.alerts.criticalOnly() }}
                  >
                    Critical
                  </Button>
                </Show>
                <Button
                  data-testid="nifty-oi-replay-button"
                  size="sm"
                  variant="subtle"
                  disabled={
                    store.alerts.trailCursor() !== null || store.alerts.trail().length === 0
                  }
                  onClick={() => store.alerts.playTrail()}
                  {...{ title: "Replay the day's alerts as toasts (verification only)" }}
                >
                  {store.alerts.trailCursor() !== null ? "Testing…" : "Test alerts"}
                </Button>
                <Button size="sm" variant="subtle" onClick={() => store.alerts.clearTrail()}>
                  Clear
                </Button>
              </Box>
            }
          >
            <MarketAlertLog
              alerts={store.alerts.displayedTrail()}
              fill={false}
              height={oiBurstLogHeight(store.alerts.displayedTrail().length)}
              onOpen={() => scrollToLog()}
            />
          </CompactPanel>
        </Box>
      </Show>
    </Box>
  );
}
