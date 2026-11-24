import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { Sparkline } from "@/components/common/Sparkline";
import { ContextCell, DecisionCell, DecisionChip, NiftySpotValue } from "./reportCells";
import { resolveRegimeLabel, regimeAccent, regimeDetail } from "./NiftyVerdictStrip";
import { pinHint } from "./niftyPin";
import {
  REPORT_FONT,
  REPORT_STRIP_CELL_MIN,
  REPORT_STRIP_GROUP_WEIGHT,
  REPORT_STRIP_METRICS,
} from "./reportTokens";
import type { DecisionView } from "./ReportDecisionStrip.derive";
import {
  FLOW_CELLS_MAX_WIDTH,
  GROUP_LABEL_STYLE,
  format2dp,
  formatInt,
} from "./ReportDecisionStrip.format";

/** One labelled zone of the stat strip. The hairline sits inside the 8px
 *  gutter (4px row gap + 1px rule + 3px inset), so cells never drift apart. */
export function StatGroup(props: {
  testId: string;
  label: string;
  weight: number;
  divider?: boolean;
  cellsTestId?: string;
  /** Claim a whole flex line on desktop and shrink the min-content footprint
   *  to the widest single cell, so the group no longer widens the grid track. */
  fullRow?: boolean;
  wrapCells?: boolean;
  cellsMaxWidth?: number;
  children: JSX.Element;
}): JSX.Element {
  const m = REPORT_STRIP_METRICS;
  return (
    <Box
      data-testid={props.testId}
      data-group-label={props.label}
      className="flex flex-col"
      style={{
        flex: props.fullRow ? "1 0 100%" : `${props.weight} 1 0%`,
        // A full-row group keeps only its widest cell as the floor: the summed
        // weight would re-widen the grid track past the viewport and pin this
        // group to the far right again. Every other group keeps the full floor
        // so its cells cannot shrink into their neighbour.
        "min-width": `${props.fullRow ? REPORT_STRIP_CELL_MIN.chipGamma : props.weight}px`,
        gap: `${m.cellGap}px`,
        ...(props.divider
          ? {
              "border-left": `1px solid ${palette.TERM_BORDER}`,
              "padding-left": `${m.groupInset}px`,
            }
          : {}),
      }}
    >
      <span data-testid={`${props.testId}-label`} title={props.label} style={GROUP_LABEL_STYLE}>
        {props.label}
      </span>
      <Box
        data-testid={props.cellsTestId ?? `${props.testId}-cells`}
        className={`flex items-stretch flex-1 min-w-0 ${props.wrapCells ? "flex-wrap" : ""}`}
        style={{
          gap: `${m.cellGap}px`,
          ...(props.cellsMaxWidth != null ? { "max-width": `${props.cellsMaxWidth}px` } : {}),
        }}
      >
        {props.children}
      </Box>
    </Box>
  );
}

function PriceGroup(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  return (
    <StatGroup
      testId="nifty-stat-group-price"
      label="PRICE"
      weight={REPORT_STRIP_GROUP_WEIGHT.price}
    >
      <DecisionCell
        testId="nifty-stat-symbol"
        minWidth={REPORT_STRIP_CELL_MIN.symbol}
        label="Index"
        value={view.symbol()}
        hint={`${view.expiry() === "nearest" ? "nearest expiry" : view.expiry()} · ${view.mode() === "eod" ? "EOD" : "live"}`}
        accent={palette.PRIMARY}
        title="Underlying whose option chain this report was built from."
      />
      <DecisionCell
        testId="nifty-stat-change"
        minWidth={REPORT_STRIP_CELL_MIN.change}
        label="Change"
        value={view.sessionChange() ? view.formatSignedPoints(view.sessionChange()!.pts) : "—"}
        hint={
          view.sessionChange()
            ? `${view.sessionChange()!.pct >= 0 ? "+" : ""}${view.sessionChange()!.pct.toFixed(2)}% vs open`
            : "vs session open"
        }
        accent={view.changeTone()}
        title="Session change against today's open — the report carries no previous close, so this is deliberately not labelled day-change."
      />
      <DecisionCell
        testId="nifty-stat-spot"
        minWidth={REPORT_STRIP_CELL_MIN.spot}
        label="Spot"
        value={
          <NiftySpotValue live={view.mode() === "live"} fallback={view.report()?.spot ?? 0} />
        }
        valueSize={REPORT_FONT.value}
        hint={
          view.dayRange()
            ? `day ${formatNumberIN(Math.round(view.dayRange()!.low))}–${formatNumberIN(
                Math.round(view.dayRange()!.high),
              )}`
            : "intraday range"
        }
        title="NIFTY 50 spot, with today's low–high range underneath."
      />
      <DecisionCell
        testId="nifty-stat-regime"
        minWidth={REPORT_STRIP_CELL_MIN.regime}
        label="Regime"
        value={
          view.regime()?.verdict ? resolveRegimeLabel(view.regime()!.verdict, view.regime()) : "—"
        }
        hint={regimeDetail(view.regime())}
        accent={regimeAccent(view.regime()?.verdict)}
        title="Volatility regime: sell premium in a range (realised < implied), buy premium in expansion (realised > implied)."
      />
      <DecisionCell
        testId="nifty-stat-flip"
        minWidth={REPORT_STRIP_CELL_MIN.flip}
        label="Gamma flip"
        value={
          view.gexDegraded()
            ? "n/a"
            : view.gammaFlip() != null
              ? formatInt(view.gammaFlip()!)
              : "—"
        }
        hint={
          view.gexDegraded()
            ? "no dealer gamma snapshot — option greeks are missing"
            : view.flipDelta() != null
              ? `spot ${view.formatSignedPoints(view.flipDelta()!)}`
              : "no dealer gamma cross at spot, so no flip strike"
        }
        accent={palette.TERM_FLIP}
        title="Dealer gamma flip: the strike where cumulative dealer gamma crosses zero at spot. Above it dealers damp moves; below it they amplify. The hint is spot minus the flip."
      />
    </StatGroup>
  );
}

function WallsGroup(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  // A missing max pain must stay a bare dash: printing 0 (or the label alone)
  // next to the PIN cell invents a level and mislabels it.
  const hasMaxPain = () => {
    const value = view.report()?.maxPain;
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  };
  return (
    <StatGroup
      testId="nifty-stat-group-walls"
      label="WALLS"
      weight={REPORT_STRIP_GROUP_WEIGHT.walls}
      divider
    >
      <DecisionCell
        testId="nifty-stat-call-wall"
        minWidth={REPORT_STRIP_CELL_MIN.callWall}
        label="Max-OI call"
        value={view.maxCallWall() ? formatInt(view.maxCallWall()!.strike) : "—"}
        valueSize={REPORT_FONT.value}
        hint={
          view.maxCallWall()
            ? `CE OI ${view.formatOiCr(view.maxCallWall()!.oi)}${
                view.maxCallDistance() != null && Number.isFinite(view.maxCallDistance()!)
                  ? ` · ${view.maxCallDistance()! > 0 ? "+" : ""}${Math.round(view.maxCallDistance()!)} pts`
                  : ""
              }`
            : "no call OI"
        }
        accent={palette.TERM_CE}
        title="Heaviest OI across the chain (not the nearest strike). Max-OI call wall is the dealers' upside hedge; the distance from spot is shown next to the OI."
      />
      <DecisionCell
        testId="nifty-stat-put-wall"
        minWidth={REPORT_STRIP_CELL_MIN.putWall}
        label="Max-OI put"
        value={view.maxPutWall() ? formatInt(view.maxPutWall()!.strike) : "—"}
        hint={
          view.maxPutWall()
            ? `PE OI ${view.formatOiCr(view.maxPutWall()!.oi)}${
                view.maxPutDistance() != null && Number.isFinite(view.maxPutDistance()!)
                  ? ` · ${view.maxPutDistance()! > 0 ? "+" : ""}${Math.round(view.maxPutDistance()!)} pts`
                  : ""
              }`
            : "no put OI"
        }
        accent={palette.TERM_PE}
        title="Heaviest OI across the chain (not the nearest strike). Max-OI put wall is the dealers' downside hedge; the distance from spot is shown next to the OI."
      />
      <DecisionCell
        testId="nifty-stat-pin"
        minWidth={REPORT_STRIP_CELL_MIN.pin}
        label="Pin risk"
        value={view.pin() ? view.pin()!.level : "—"}
        hint={view.pin() ? pinHint(view.pin()) : "spot / max pain missing"}
        accent={
          view.pin()?.level === "HIGH"
            ? palette.WARNING
            : view.pin()?.level === "MEDIUM"
              ? palette.TEXT
              : palette.TEXT_MUTED
        }
        title="Pin detection: a wall at spot AND max pain at least 100 pts on the far side means the market is being pinned into expiry. A break there is usually a sweep — sell the range, and only buy a break after two consecutive 1-min closes beyond the wall."
      />
      <ContextCell
        testId="nifty-stat-max-pain"
        minWidth={REPORT_STRIP_CELL_MIN.maxPain}
        label="Max pain"
        value={
          <>
            <Show when={hasMaxPain()}>
              <span
                data-testid="nifty-maxpain-inline-label"
                className="text-ui-micro font-bold uppercase text-fin-text-muted"
                style={{
                  "text-align": "left",
                  "white-space": "nowrap",
                  // Spend the shared 8px gutter as 4px gap + 1px rule + 3px
                  // inset, so this number cannot read as the PIN cell's value.
                  "margin-left": `${REPORT_STRIP_METRICS.cellGap}px`,
                  "border-left": `${REPORT_STRIP_METRICS.groupHairline}px solid ${palette.TERM_BORDER}`,
                  "padding-left": `${REPORT_STRIP_METRICS.groupInset}px`,
                  "margin-right": `${REPORT_STRIP_METRICS.cellGap}px`,
                }}
              >
                MAX PAIN
              </span>
            </Show>
            <AnimatedValue
              value={hasMaxPain() ? view.report()?.maxPain : undefined}
              format={formatInt}
            />
            <Show when={hasMaxPain()}>
              <Sparkline
                values={view.maxPainSeries()}
                testId="nifty-maxpain-spark"
                color={palette.PRIMARY}
              />
            </Show>
          </>
        }
        valueSize={REPORT_FONT.value}
        title="Max pain — the strike where the most option contracts would expire worthless. Writers tend to pin price there into expiry; it is a magnet, not a forecast."
      />
    </StatGroup>
  );
}

function VolatilityGroup(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  return (
    <StatGroup
      testId="nifty-stat-group-volatility"
      label="VOLATILITY"
      weight={REPORT_STRIP_GROUP_WEIGHT.volatility}
      divider
      cellsTestId="nifty-context-stats"
    >
      <Show when={view.squeezeFuel()}>
        {(fuel) => (
          <DecisionCell
            testId="nifty-squeeze-fuel"
            minWidth={REPORT_STRIP_CELL_MIN.squeezeFuel}
            label="Squeeze fuel"
            value="Building ↑"
            hint={`${fuel().strike} call wall is ${fuel().sentiment === "SC" ? "short-covering" : "unwinding"} — a break above it accelerates`}
            accent={palette.WARNING}
            title="Squeeze fuel: price is pinned under the call wall and that wall's call OI is being covered (short-covering / long unwind). Writers are buying back the ceiling, so a break above it is fuel, not a cap. The opposite is a defended wall."
          />
        )}
      </Show>
      <ContextCell
        testId="nifty-stat-pcr-oi"
        minWidth={REPORT_STRIP_CELL_MIN.pcrOi}
        label="P/C ratio · OI"
        value={
          <>
            <AnimatedValue value={view.report()?.pcrOi ?? 0} format={format2dp} />
            <Sparkline
              values={view.pcrSeries()}
              testId="nifty-pcr-spark"
              color={palette.TERM_CE}
            />
          </>
        }
        title="Put/call ratio · open interest — the ratio by open interest (outstanding contracts still held). Open interest is accumulated positioning; compare it with the put/call ratio by traded volume, which is today's flow."
      />
      <ContextCell
        testId="nifty-stat-pcr-vol"
        minWidth={REPORT_STRIP_CELL_MIN.pcrVol}
        label="P/C ratio · volume"
        value={<AnimatedValue value={view.report()?.pcrVol ?? 0} format={format2dp} />}
        title="Put/call ratio · volume — the ratio by traded volume this session. Volume is short-term flow; compare it with the put/call ratio by open interest, which is accumulated positioning."
      />
    </StatGroup>
  );
}

function FlowGroup(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  return (
    <StatGroup
      testId="nifty-stat-group-flow"
      label="FLOW & ACTION"
      weight={REPORT_STRIP_GROUP_WEIGHT.flow}
      divider
      fullRow={!view.narrow()}
      wrapCells
      cellsMaxWidth={FLOW_CELLS_MAX_WIDTH}
    >
      <DecisionChip
        testId="nifty-chip-setup"
        minWidth={REPORT_STRIP_CELL_MIN.chipSetup}
        label="Setup checks"
        value={view.setupSummary()}
        onClick={() => view.store.ui.setDeskDockTab("setup")}
        help={view.setupHelp()}
        ariaLabel="Setup checks — open the Setup tab with all seven checks"
        fill
      />
      <DecisionChip
        testId="nifty-chip-intel"
        minWidth={REPORT_STRIP_CELL_MIN.chipIntel}
        label="Institutional flows"
        value="FII / DII"
        onClick={() => view.store.ui.setDeskDockTab("market")}
        help={view.INTEL_CHIP_HELP}
        ariaLabel="Institutional flows — open the market panel for FII and DII net flows"
        fill
      />
      <DecisionChip
        testId="nifty-chip-gamma"
        minWidth={REPORT_STRIP_CELL_MIN.chipGamma}
        label="Dealer gamma"
        value={
          view.gexDegraded()
            ? "n/a"
            : `${view.gexForDisplay()?.regime === "short" ? "SHORT" : "LONG"} ${view.gammaFlip() != null ? formatInt(view.gammaFlip()!) : "—"}`
        }
        onClick={() => view.store.ui.setGammaOpen(true)}
        tone={view.gexForDisplay()?.regime === "short" ? palette.NEGATIVE : palette.POSITIVE}
        help={view.gammaChipHelp()}
        ariaLabel="Dealer gamma — open the dealer gamma profile"
        fill
      />
    </StatGroup>
  );
}

/** The detail bands behind More stats: every derived stat cell and chip,
 *  with the same testids, units, hints and 12/13/16 type hierarchy. */
export function DecisionStats(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  return (
    <Box className="flex flex-wrap min-[1200px]:flex-nowrap items-stretch min-w-0 min-h-[28px]">
      <Box
        data-testid="nifty-decision-stats"
        className="flex flex-wrap flex-auto min-w-0 w-full [&_[data-testid$='-value']]:text-right"
        style={{ gap: `${REPORT_STRIP_METRICS.groupRowGap}px` }}
      >
        <PriceGroup view={view} />
        <WallsGroup view={view} />
        <VolatilityGroup view={view} />
        {/* Claim a whole line and keep the chips at their measured width:
            the old summed floor widened the grid track past 1600, so the
            group sat at the far right and Institutional flows read "Ins". */}
        <Show when={view.isDesk()}>
          <FlowGroup view={view} />
        </Show>
      </Box>
    </Box>
  );
}
