import { Show } from "solid-js";
import { Button } from "@/ui";
import * as palette from "@/ui/palette";
import { EmptyState, injectCollapseRule } from "@/components/common/states";
import { isMarketOpenNow } from "@/state/holidays";
import { ReplayUnavailable } from "./BreadthStrip";
import { LocalCompactPanel } from "./reportBits";
import { REPORT_FONT, REPORT_PAD } from "./reportTokens";
import type { WallsCardProps } from "./NiftyWallsCard.shared";
import { WallsSkeleton, WallsLevelsBlock } from "./NiftyWallsCard.skeleton";

/** The null-payload card: three emptinesses, one row each, at the same height
 *  as the populated band. `emptyText` stays on the description so callers that
 *  pass copy still see it rendered. */
export function WallsEmpty(props: WallsCardProps) {
  const emptyText = () => props.emptyText ?? "No walls data.";
  const emptyReason = (): "no-data" | "market-closed" | "failed" => {
    // Replay has no snapshot and the recorder did not write this band: both
    // are "not captured", never a fetch failure.
    if (props.unavailableInReplay || props.noDataRecorded || props.loadFailed === false) return "no-data";
    // Market shut: nothing to read yet. This is the clock, not a fault.
    if (!isMarketOpenNow()) return "market-closed";
    // Live session and the request came back empty. `walls === null` inside
    // market hours IS the failed state; there is no separate signal a caller
    // could have passed, so it must not silently read as "quiet".
    return "failed";
  };
  const emptyCopy = (): { kind: "no-data" | "market-closed" | "failed"; title: string; description: string; hint: string } => {
    switch (emptyReason()) {
      case "market-closed":
        // A closed snapshot is not "not recorded yet": the session was recorded
        // and this band was not captured. The next open is a different session,
        // so naming it here would describe a frame the page is not showing.
        return {
          kind: "market-closed",
          title: "No walls snapshot for this session",
          description: emptyText(),
          hint: "",
        };
      case "failed":
        return {
          kind: "failed",
          title: "Walls request failed",
          description: "The walls snapshot came back empty during a live session.",
          hint: props.onRetry ? "Retry re-reads the snapshot" : "",
        };
      case "no-data":
      default:
        return {
          kind: "no-data",
          title: props.unavailableInReplay ? "Walls not captured" : "No walls snapshot",
          description: emptyText(),
          hint: props.unavailableInReplay ? "live-only band" : "",
        };
    }
  };
  const retry = () =>
    emptyReason() === "failed" && props.onRetry ? (
      <Button
        data-testid="nifty-walls-retry"
        size="xs"
        variant="outline"
        onClick={() => props.onRetry?.()}
        className="min-w-0"
        style={{ "font-size": `${REPORT_FONT.micro}px`, "padding-left": `${REPORT_PAD.sm}px`, "padding-right": `${REPORT_PAD.sm}px` }}
      >
        Retry
      </Button>
    ) : undefined;
  return (
    <LocalCompactPanel
      title="WALLS"
      testId={props.testId ?? "nifty-walls-card"}
      flush
      action={retry()}
      class="[&>div:first-child]:bg-fin-surface-alt"
      style={{ "border-width": "0px", "background-color": palette.SURFACE }}
    >
      <Show
        when={props.compact === true}
        fallback={
          <>
            <WallsSkeleton emptyText={emptyText()} replayUnavailable={props.unavailableInReplay} />
            <WallsLevelsBlock levels={props.levels} />
          </>
        }
      >
        {/*
         * The rail's height is fixed by its consumer (ReportWorkspace, not
         * this lane's file). An empty band must not keep paying for a 112px
         * reserve, so this rule lets the rail shrink to the row it actually
         * renders. Injected into the head because a `<style>` child would
         * show up in the rail's own text.
         */}
        {injectCollapseRule(
          "walls-rail",
          `[data-testid="desk-insight-rail"]:has([data-testid="nifty-walls-card-rail"] [data-empty-kind]){height:auto !important;}`,
        )}
        <div data-testid="nifty-walls-compact-summary" class="px-1 py-1">
          <EmptyState
            kind={emptyCopy().kind}
            layout="row"
            title={emptyCopy().title}
            description={emptyCopy().description}
            hint={emptyCopy().hint}
            data-testid="nifty-walls-compact-summary-text"
          />
        </div>
        {/* In replay this detail is permanently display:none — a skeleton
            that can never be opened is dead DOM, so don't mount it. */}
        <Show when={!props.unavailableInReplay}>
          <div data-testid="nifty-walls-compact-detail" style={{ display: "none" }}>
            <WallsSkeleton emptyText={emptyText()} />
            <WallsLevelsBlock levels={props.levels} />
          </div>
        </Show>
        {/* Replay keeps the one phrase the mode banner already established. */}
        <Show when={props.unavailableInReplay}>
          <ReplayUnavailable noun="Walls" className="sr-only" />
        </Show>
      </Show>
    </LocalCompactPanel>
  );
}
