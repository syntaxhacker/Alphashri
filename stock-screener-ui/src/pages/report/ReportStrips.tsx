import { Show, createMemo } from "solid-js";

import { Box, Button, Text } from "@/ui";
import { CompactPanel } from "@/components/common/compact";
import { MarketAlertLog, MarketAlertStack } from "@/components/notifications/MarketAlertCard";

import { BreadthStrip } from "./BreadthStrip";
import { LevelsInPlayContent } from "./LevelsInPlay";
import { Nifty10sStrip } from "./Nifty10sStrip";
import { NiftyDeskPlan } from "./NiftyDeskPlan";
import { NiftyPressureDesk } from "./NiftyPressureDesk";
import { NiftySqueezeRadar } from "./NiftySqueezeRadar";
import type { WallSnapshot } from "./NiftySqueezeRadar";
import { NiftyWallErosionBoard } from "./NiftyWallErosionBoard";
import { NiftyWallsCard } from "./NiftyWallsCard";
import { NiftyWallsExpanded } from "./NiftyWallsExpanded";
import { useNiftyReport } from "./ReportContext";
import { oiBurstLogHeight } from "./reportCells";
import { flowNoiseFor } from "./symbolMetrics";
import { OI_ALERT_TOAST_MAX } from "./useNiftyOiAlerts";

const EMPTY_WALL_HISTORY: WallSnapshot[] = [];

export function ReportStrips() {
  const store = useNiftyReport();

  const report = () => store.data.report();
  const mode = () => store.selection.mode();
  const symbol = () => store.selection.symbol();
  const wallsPayload = () => store.walls.data();

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
      className="flex flex-col gap-1 w-full max-w-full min-w-0 shrink-0"
    >
      <Show
        when={mode() === "live"}
        fallback={
          <Text
            data-testid="nifty-breadth-live-only"
            className="flex items-center h-6 min-h-6 px-2 text-[10px] text-fin-text-muted tracking-[0.06em] uppercase"
          >
            BREADTH · live only
          </Text>
        }
      >
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

      <NiftyWallsCard
        walls={wallsPayload()}
        onExpand={() => store.walls.openDrawer()}
        onOpenDesk={() => store.ui.setDeskOpen(true)}
        emptyText={
          mode() === "eod" ? "No tape at this replay time." : "Waiting for walls data."
        }
        levels={
          symbol() === "NIFTY" ? (
            <LevelsInPlayContent report={report()} sensex={store.data.sensex()} />
          ) : undefined
        }
      />

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

      <NiftyPressureDesk
        open={store.ui.deskOpen()}
        walls={wallsPayload()}
        onClose={() => store.ui.setDeskOpen(false)}
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
                style={{
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "4px",
                  "min-width": 0,
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
                    className="inline-flex items-center text-[9px] font-bold tracking-[0.08em] text-fin-negative border border-fin-negative rounded-[3px] px-1 py-[1px] whitespace-nowrap nifty-critical-pulse"
                  >
                    CRITICAL {store.alerts.criticalCount()}
                  </Box>
                </Show>
              </span>
            }
            testId="nifty-oi-bursts-panel"
            action={
              <Box className="flex gap-1 items-center">
                <Button
                  data-testid="nifty-alert-sound-toggle"
                  size="sm"
                  variant="subtle"
                  onClick={() => store.alerts.toggleSound()}
                  className="min-w-[24px] px-1 text-[13px] leading-none"
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
