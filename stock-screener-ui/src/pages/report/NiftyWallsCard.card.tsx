import { createEffect, createSignal, Show } from "solid-js";
import { Badge, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { LocalCompactPanel } from "./reportBits";
import { STATE_COLOR, firstBreakEvent, lastBreakEvent, formatDte, fmtNum } from "./niftyWallsFormat";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";
import type { WallsCardProps } from "./NiftyWallsCard.shared";
import { injectCollapseRule } from "@/components/common/states";
import { isMarketOpenNow } from "@/state/holidays";
import { Stat, WallsLevelsLegend } from "./NiftyWallsCard.stats";
import { WallTable } from "./NiftyWallsCard.table";
import { MiniHistory } from "./NiftyWallsCard.history";
import { WallsRead } from "./NiftyWallsCard.read";
import { WallsLevelsBlock } from "./NiftyWallsCard.skeleton";

// The focused empty-state module stays on this card's public surface; the null
// branch itself renders a collapsed status line so the rail cannot reserve
// five-column data height for a frame where no walls were captured.
export { WallsEmpty } from "./NiftyWallsCard.empty";

export function NiftyWallsCardInner(props: WallsCardProps) {
  const walls = () => props.walls;
  const [dismissed, setDismissed] = createSignal<string | null>(null);

  // One alert per wall per cooldown: the backend latches `alert.at` to the
  // first break of the run; localStorage makes the dismiss survive reloads
  // and suppresses a re-break inside the same 15-minute window.
  createEffect(() => {
    const currentWalls = walls();
    if (!currentWalls?.alert) return;
    const alert = currentWalls.alert;
    const key = `walls.alert.v1.${currentWalls.symbol}.${currentWalls.date}.${alert.wall}`;
    try {
      const stored = window.localStorage.getItem(key);
      if (!stored) return;
      const storedAt = Date.parse(stored);
      const at = Date.parse(alert.at);
      if (
        storedAt === at ||
        (Number.isFinite(at) &&
          Number.isFinite(storedAt) &&
          at - storedAt < alert.cooldown_min * 60_000)
      ) {
        setDismissed(alert.at);
      }
    } catch {
      /* localStorage can be blocked; the in-memory dismiss still works */
    }
  });

  if (!walls()) {
    const emptyKind = () => {
      if (props.unavailableInReplay || props.noDataRecorded || props.loadFailed === false) {
        return "no-data";
      }
      return isMarketOpenNow() ? "failed" : "market-closed";
    };
    const status = () => {
      const reason = props.emptyText ?? "No walls data.";
      if (props.unavailableInReplay) return `Walls not captured · ${reason} · live-only band`;
      if (emptyKind() === "failed") return `Walls request failed · ${reason}`;
      if (emptyKind() === "market-closed") return `No walls snapshot · ${reason}`;
      return reason;
    };
    return (
      <div
        data-testid={props.testId ?? "nifty-walls-card"}
        data-walls-empty="collapsed"
        data-empty-kind={emptyKind()}
        title="The walls band is captured from the live option chain; this frame has no snapshot."
        class="flex h-5 min-h-5 w-full min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap px-2 text-ui-micro text-fin-text-muted"
      >
        {injectCollapseRule(
          "walls-rail",
          `[data-testid="desk-insight-rail"]:has([data-testid="nifty-walls-card-rail"] [data-empty-kind]){height:auto !important;}`,
        )}
        <span data-testid="nifty-walls-compact-summary" class="min-w-0 truncate">
          {status()}
        </span>
        <Show when={emptyKind() === "failed" && props.onRetry}>
          <button
            data-testid="nifty-walls-retry"
            type="button"
            class="shrink-0 rounded-sm text-ui-micro text-fin-primary"
            style={{ "text-decoration": "underline" }}
            onClick={() => props.onRetry?.()}
          >
            Retry
          </button>
        </Show>
      </div>
    );
  }
  const stateColor = () => STATE_COLOR[walls()!.state] ?? palette.TEXT_MUTED;
  const alert = () => walls()!.alert;
  const showAlert = () => Boolean(alert() && walls()!.alert_eligible && dismissed() !== alert()!.at);
  const events = () => walls()!.events ?? [];
  const firstBreak = () => firstBreakEvent(events()) ?? null;
  const lastBreak = () => lastBreakEvent(events()) ?? null;
  const breakEvent = () => firstBreak() ?? lastBreak();
  const dteLabel = () => formatDte(walls()!.dte);
  const pinColor = () =>
    Math.abs(walls()!.pin_distance_pct) <= 0.15 ? palette.PRIMARY : palette.TEXT_MUTED;
  const dismiss = (at: string, wall: number) => {
    setDismissed(at);
    const currentWalls = walls();
    if (!currentWalls) return;
    try {
      window.localStorage.setItem(
        `walls.alert.v1.${currentWalls.symbol}.${currentWalls.date}.${wall}`,
        at,
      );
    } catch {
      /* ignore */
    }
  };

  return (
    <LocalCompactPanel
      title="WALLS"
      testId={props.testId ?? "nifty-walls-card"}
      action={
        <div class="flex items-center gap-1">
          {props.onOpenDesk ? (
            <Button
              size="xs"
              variant="outline"
              data-testid="nifty-walls-desk"
              onClick={props.onOpenDesk}
              className="min-w-0"
              style={{
                "padding-left": `${REPORT_PAD.sm}px`,
                "padding-right": `${REPORT_PAD.sm}px`,
                "min-width": 0,
                "font-size": `${REPORT_FONT.micro}px`,
              }}
            >
              DESK
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            onClick={props.onExpand}
            className="min-w-0"
            style={{
              "padding-left": `${REPORT_PAD.sm}px`,
              "padding-right": `${REPORT_PAD.sm}px`,
              "min-width": 0,
              "font-size": `${REPORT_FONT.micro}px`,
            }}
          >
            ALL WALL STATS
          </Button>
        </div>
      }
      class="[&>div:first-child]:bg-fin-surface-alt"
      style={{ "border-width": "0px", "background-color": palette.SURFACE }}
    >
      <Show when={props.compact === true}>
        <div
          data-testid="nifty-walls-compact-summary"
          class="flex flex-col justify-center gap-[2px] w-full min-w-0 shrink-0 h-14 min-h-14 px-2 font-mono"
        >
          <div class="flex items-center gap-2 min-w-0 whitespace-nowrap overflow-x-auto [&>*]:shrink-0">
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.xs}px`,
                "font-weight": REPORT_FONT_WEIGHT.extrabold,
                color: stateColor(),
              }}
            >
              {walls()!.state.replace("_", " ")}
            </Text>
            <Text
              size="xs"
              span
              style={{ "font-size": `${REPORT_FONT.xs}px`, color: palette.TEXT_MUTED }}
            >
              {dteLabel()} · {walls()!.expiry ?? "—"} · tape {walls()!.freshness.last_t.slice(11, 16)}
            </Text>
            <Text
              size="xs"
              span
              style={{ "font-size": `${REPORT_FONT.xs}px`, color: palette.TEXT_MUTED }}
            >
              <span class="text-ui-micro">CW</span> {fmtNum(walls()!.call_wall?.strike)} · <span class="text-ui-micro">PW</span> {fmtNum(walls()!.put_wall?.strike)}
            </Text>
          </div>
          <div class="flex items-center gap-3 min-w-0 whitespace-nowrap overflow-x-auto">
            <div
              data-walls-stat="spot"
              class="flex items-center gap-1 min-w-0 shrink-0"
              title={`SPOT ${fmtNum(walls()!.spot, 2)}`}
            >
              <span class="text-ui-micro shrink-0" style={{ color: palette.TEXT_MUTED }}>SPOT</span>
              <Text
                size="xs"
                span
                className="font-mono tabular-nums truncate min-w-0"
                style={{ "font-size": `${REPORT_FONT.xs}px`, color: palette.TEXT_MUTED }}
              >
                {fmtNum(walls()!.spot, 2)}
              </Text>
            </div>
            <div
              data-walls-stat="max-pain"
              class="flex items-center gap-1 min-w-0 shrink-0 border-l pl-2"
              style={{ "border-left-color": palette.BORDER }}
              title={`MAX PAIN ${fmtNum(walls()!.max_pain)}`}
            >
              <span class="text-ui-micro shrink-0" style={{ color: palette.TEXT_MUTED }}>MP</span>
              <Text
                size="xs"
                span
                className="font-mono tabular-nums truncate min-w-0"
                style={{ "font-size": `${REPORT_FONT.xs}px`, color: palette.TEXT_MUTED }}
              >
                {fmtNum(walls()!.max_pain)}
              </Text>
            </div>
            <div
              data-walls-stat="pin"
              class="flex items-center gap-1 min-w-0 shrink-0 border-l pl-2"
              style={{ "border-left-color": palette.BORDER }}
              title={`PIN ${walls()!.pin_distance_pts > 0 ? "+" : ""}${fmtNum(walls()!.pin_distance_pts, 0)} (${walls()!.pin_distance_pct.toFixed(2)}%)`}
            >
              <span class="text-ui-micro shrink-0" style={{ color: palette.TEXT_MUTED }}>PIN</span>
              <Text
                size="xs"
                span
                className="font-mono tabular-nums truncate min-w-0"
                style={{ "font-size": `${REPORT_FONT.xs}px`, color: pinColor() }}
              >
                {walls()!.pin_distance_pts > 0 ? "+" : ""}{fmtNum(walls()!.pin_distance_pts, 0)} ({walls()!.pin_distance_pct.toFixed(2)}%)
              </Text>
            </div>
            <div
              data-walls-stat="gex"
              class="flex items-center gap-1 min-w-0 shrink-0 border-l pl-2"
              style={{ "border-left-color": palette.BORDER }}
              title={`GEX ${walls()!.gex_degraded ? "n/a" : fmtNum(walls()!.net_gex, 1)}`}
            >
              <span class="text-ui-micro shrink-0" style={{ color: palette.TEXT_MUTED }}>GEX</span>
              <Text
                size="xs"
                span
                className="font-mono tabular-nums truncate min-w-0"
                style={{
                  "font-size": `${REPORT_FONT.xs}px`,
                  color: walls()!.gex_degraded ? palette.TEXT_MUTED : palette.TEXT_COLOR,
                }}
              >
                {walls()!.gex_degraded ? "n/a" : fmtNum(walls()!.net_gex, 1)}
              </Text>
            </div>
            <Show when={showAlert() && alert()}>
              <div
                data-walls-stat="alert"
                class="flex items-center min-w-0 shrink-0 border-l pl-2"
                style={{ "border-left-color": palette.BORDER }}
                title={`WALL BREAK ${fmtNum(alert()!.wall)} · ${fmtNum(alert()!.spot, 1)}`}
              >
                <Text
                  size="xs"
                  span
                  className="font-mono tabular-nums truncate min-w-0"
                  style={{ "font-size": `${REPORT_FONT.xs}px`, "font-weight": REPORT_FONT_WEIGHT.extrabold, color: palette.NEGATIVE }}
                >
                  WALL BREAK {fmtNum(alert()!.wall)} · {fmtNum(alert()!.spot, 1)}
                </Text>
              </div>
            </Show>
          </div>
          <div
            data-testid="nifty-walls-compact-scroll-cue"
            class="text-ui-micro text-fin-text-muted min-[420px]:hidden"
          >
            scroll → for all levels
          </div>
        </div>
      </Show>
      <div
        data-testid="nifty-walls-compact-detail"
        style={{ display: props.compact === true ? "none" : "contents" }}
      >
      <div
        // auto-fit follows this grid's own width, not the viewport: the old
        // min-[1100px] track list forced 690px into the 472px windowed desk and
        // clipped 218px of labels. It wraps to 1-2 narrow columns here and
        // expands on a wide monitor without a media-query/inline-style race.
        class="grid items-start gap-[8px] p-[8px] grid-cols-[repeat(auto-fit,minmax(190px,1fr))]"
        data-testid="nifty-walls-grid"
      >
        <div class="min-w-0">
          <div class="flex items-center flex-wrap gap-2" style={{ "align-items": "center", "flex-wrap": "wrap", "row-gap": `${REPORT_PAD.xs}px` }}>
            <Badge
              size="xs"
              variant="outline"
              color={stateColor()}
              className="min-w-0"
              style={{
                "height": "18px",
                "font-size": `${REPORT_FONT.xs}px`,
                "font-weight": REPORT_FONT_WEIGHT.extrabold,
                "letter-spacing": REPORT_LETTER_SPACING.wide,
                color: stateColor(),
                "background-color": palette.alpha(stateColor(), 0.12),
                border: "none",
                "padding-left": `${REPORT_PAD.xs}px`,
                "padding-right": `${REPORT_PAD.xs}px`,
              }}
            >
              {walls()!.state.replace("_", " ")}
            </Badge>
            {dteLabel() && (
              <Text
                size="xs"
                span
                fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
                title={dteLabel()}
                className="min-w-0 truncate"
                style={{
                  "font-size": `${REPORT_FONT.xs}px`,
                  "font-weight": REPORT_FONT_WEIGHT.bold,
                  color: walls()!.expiry_day ? palette.WARNING : palette.TEXT_MUTED,
                  "white-space": "nowrap",
                }}
              >
                {dteLabel()}
              </Text>
            )}
            <Text
              size="xs"
              span
              title={`${walls()!.expiry ?? "—"} · tape ${walls()!.freshness.last_t.slice(11, 16)}`}
              className="min-w-0 truncate"
              style={{
                "font-size": `${REPORT_FONT.xs}px`,
                color: palette.TEXT_MUTED,
                "white-space": "nowrap",
              }}
            >
              {walls()!.expiry ?? "—"} · tape {walls()!.freshness.last_t.slice(11, 16)}
            </Text>
            {walls()!.freshness.stale && (
              <Badge
                size="xs"
                variant="outline"
                color="warning"
                className="min-w-0"
                style={{
                  "height": "17px",
                  "font-size": `${REPORT_FONT.xs}px`,
                  color: palette.WARNING,
                  "background-color": palette.alpha(palette.WARNING, 0.12),
                  border: "none",
                  "padding-left": `${REPORT_PAD.xs}px`,
                  "padding-right": `${REPORT_PAD.xs}px`,
                }}
              >
                STALE
              </Badge>
            )}
          </div>

          <div
            style={{
              display: "grid",
              "grid-template-columns": "1fr 1fr",
              "column-gap": `${REPORT_PAD.md}px`,
              "row-gap": `${REPORT_PAD.xs}px`,
              "margin-top": `${REPORT_PAD.sm}px`,
            }}
          >
            <Stat label="SPOT" value={fmtNum(walls()!.spot, 2)} />
            <Stat label="MAX PAIN" value={fmtNum(walls()!.max_pain)} />
            <Stat
              label="PIN"
              value={`${walls()!.pin_distance_pts > 0 ? "+" : ""}${fmtNum(walls()!.pin_distance_pts, 0)} (${walls()!.pin_distance_pct.toFixed(2)}%)`}
              color={pinColor()}
            />
            <Stat
              label="GEX"
              value={walls()!.gex_degraded ? "n/a" : fmtNum(walls()!.net_gex, 1)}
              color={walls()!.gex_degraded ? palette.TEXT_MUTED : palette.TEXT_COLOR}
            />
          </div>
          <div style={{ "margin-top": `${REPORT_PAD.xs}px` }}>
            <WallsLevelsLegend
              callWall={walls()!.call_wall?.strike ?? null}
              putWall={walls()!.put_wall?.strike ?? null}
              maxPain={walls()!.max_pain ?? null}
            />
          </div>

        </div>

        <div class="min-w-0">
          <WallTable side="CALL" rows={walls()!.calls} spot={walls()!.spot} />
        </div>
        <div class="min-w-0">
          <WallTable side="PUT" rows={walls()!.puts} spot={walls()!.spot} />
        </div>

        <div class="min-w-0">
          <WallsRead
            walls={walls()!}
            alert={alert()}
            showAlert={showAlert()}
            breakEvent={breakEvent()}
            lastBreak={lastBreak()}
            events={events()}
            onDismiss={dismiss}
          />
        </div>

        <div class="min-w-0">
          <MiniHistory walls={walls()!} />
        </div>
      </div>
      <WallsLevelsBlock levels={props.levels} />
      </div>
    </LocalCompactPanel>
  );
}

export const NiftyWallsCard = NiftyWallsCardInner;
