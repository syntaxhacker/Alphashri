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
import { WallsEmpty } from "./NiftyWallsCard.empty";
import { Stat, WallsLevelsLegend } from "./NiftyWallsCard.stats";
import { WallTable } from "./NiftyWallsCard.table";
import { MiniHistory } from "./NiftyWallsCard.history";
import { WallsRead } from "./NiftyWallsCard.read";
import { WallsLevelsBlock } from "./NiftyWallsCard.skeleton";

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
    return <WallsEmpty {...props} />;
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
            EXPAND
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
          <div class="flex items-center gap-2 min-w-0 whitespace-nowrap overflow-x-auto [&>*]:shrink-0">
            <Text size="xs" span style={{ "font-size": `${REPORT_FONT.xs}px`, color: palette.TEXT_MUTED }}>
              <span class="text-ui-micro">SPOT</span> {fmtNum(walls()!.spot, 2)}
            </Text>
            <Text size="xs" span style={{ "font-size": `${REPORT_FONT.xs}px`, color: palette.TEXT_MUTED }}>
              <span class="text-ui-micro">MP</span> {fmtNum(walls()!.max_pain)}
            </Text>
            <Text
              size="xs"
              span
              style={{ "font-size": `${REPORT_FONT.xs}px`, color: pinColor() }}
            >
              <span class="text-ui-micro">PIN</span> {walls()!.pin_distance_pts > 0 ? "+" : ""}
              {fmtNum(walls()!.pin_distance_pts, 0)} ({walls()!.pin_distance_pct.toFixed(2)}%)
            </Text>
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.xs}px`,
                color: walls()!.gex_degraded ? palette.TEXT_MUTED : palette.TEXT_COLOR,
              }}
            >
              <span class="text-ui-micro">GEX</span> {walls()!.gex_degraded ? "n/a" : fmtNum(walls()!.net_gex, 1)}
            </Text>
            <Show when={showAlert() && alert()}>
              <Text
                size="xs"
                span
                style={{ "font-size": `${REPORT_FONT.xs}px`, "font-weight": REPORT_FONT_WEIGHT.extrabold, color: palette.NEGATIVE }}
              >
                WALL BREAK {fmtNum(alert()!.wall)} · {fmtNum(alert()!.spot, 1)}
              </Text>
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
        // The five-column band is the point of this card: at the xs variant it
        // stacked CALL/PUT/READ/history into one column and grew to 475px,
        // which pushed the chart below the fold. Media query, not inline style,
        // so the wide layout actually wins at desk width.
        class="grid items-start gap-[8px] p-[8px] grid-cols-1 min-[1100px]:grid-cols-[250px_1fr_1fr_minmax(280px,1fr)_minmax(120px,1fr)]"
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

        <WallTable side="CALL" rows={walls()!.calls} spot={walls()!.spot} />
        <WallTable side="PUT" rows={walls()!.puts} spot={walls()!.spot} />

        <WallsRead
          walls={walls()!}
          alert={alert()}
          showAlert={showAlert()}
          breakEvent={breakEvent()}
          lastBreak={lastBreak()}
          events={events()}
          onDismiss={dismiss}
        />

        <MiniHistory walls={walls()!} />
      </div>
      <WallsLevelsBlock levels={props.levels} />
      </div>
    </LocalCompactPanel>
  );
}

export const NiftyWallsCard = NiftyWallsCardInner;
