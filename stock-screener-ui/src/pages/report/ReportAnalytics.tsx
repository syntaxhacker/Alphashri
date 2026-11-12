import { For, Show, createMemo } from "solid-js";
import type { JSX } from "solid-js";

import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";

import { LevelsInPlayContent } from "./LevelsInPlay";
import { NiftyGammaTime } from "./NiftyGammaTime";
import { NiftyIvStraddle } from "./NiftyIvStraddle";
import { NiftyParticipantFlow } from "./NiftyParticipantFlow";
import { NiftyPnlAttribution } from "./NiftyPnlAttribution";
import { NiftyStructureShifts } from "./NiftyStructureShifts";
import { NiftyTapeTable } from "./NiftyTapeTable";
import {
  NiftyUnusualVolume,
  UNUSUAL_TERM_BG,
  UNUSUAL_TERM_BORDER,
} from "./NiftyUnusualVolume";
import { NiftyVolumeProfile } from "./NiftyVolumeProfile";
import { NiftyWallMigration } from "./NiftyWallMigration";
import { gexSideCopy, gexSideLevels } from "./NiftyGexProfile";
import type { GexSideLevel } from "./NiftyGexProfile";
import { gexFlipAtSpot, gexRegimeAtSpot } from "./niftyGex";
import type { ParticipantFlowRow } from "./niftyParticipantFlow";
import type { NiftyPnlGreeks } from "./niftyPnlAttribution";
import type { WallMigrationRow } from "./niftyWallMigration";
import type { NiftyVolumeTapeRow } from "./niftyVolumeProfile";
import {
  buildOvernightLevels,
  formatGexLevel,
  formatGexTotal,
  gexRegimeText,
} from "./reportCells";
import { useNiftyReport } from "./ReportContext";

const TAPE_PANEL_STYLE: JSX.CSSProperties = {
  "min-width": 0,
  "background-color": palette.TERM_BG,
  "border-color": palette.TERM_BORDER,
};

const UNUSUAL_PANEL_STYLE: JSX.CSSProperties = {
  "min-width": 0,
  "background-color": UNUSUAL_TERM_BG,
  "border-color": UNUSUAL_TERM_BORDER,
};

const DETAIL_STYLE: JSX.CSSProperties = { "background-color": palette.TERM_HEADER };

const DETAIL_HEAD_LEFT_STYLE: JSX.CSSProperties = { gap: "8px", "min-width": 0 };

const DETAIL_HEAD_TITLE_STYLE: JSX.CSSProperties = {
  "font-size": "10px",
  "font-weight": 700,
  "letter-spacing": "0.08em",
  "text-transform": "uppercase",
  color: palette.TEXT,
  "white-space": "nowrap",
};

const DETAIL_HEAD_SUB_STYLE: JSX.CSSProperties = {
  "font-size": "10px",
  color: palette.TEXT_MUTED,
  "white-space": "nowrap",
  overflow: "hidden",
  "text-overflow": "ellipsis",
};

const DETAIL_HEAD_ACTION_STYLE: JSX.CSSProperties = {
  "font-size": "11px",
  "font-weight": 700,
  color: palette.TEXT_MUTED,
  "flex-shrink": 0,
};

const formatInt = (value: number): string => formatNumberIN(value);

const formatGexTotalValue = (value: number): string => formatGexTotal(value);

export function ReportAnalytics() {
  const store = useNiftyReport();

  const report = () => store.data.report();
  const mode = () => store.selection.mode();
  const isDesk = () => store.ui.isDesk();
  const tape = () => store.data.tape();
  const tapeRows = () => store.data.tapeRows();
  const migrationRows = () => tapeRows() as unknown as WallMigrationRow[];
  const flowRows = () => tapeRows() as unknown as ParticipantFlowRow[];
  const volumeRows = () => tapeRows() as unknown as NiftyVolumeTapeRow[];
  const updatedAtMs = () => store.data.freshness.updatedAtMs();
  const nextUpdateAtMs = () => store.data.freshness.nextUpdateAtMs();

  const levels = createMemo(() => {
    const current = report();
    return current ? buildOvernightLevels(current) : null;
  });

  const gexSides = createMemo<{ below: GexSideLevel | null; above: GexSideLevel | null }>(() => {
    const current = report();
    return current?.gex
      ? gexSideLevels(current.gex, current.spot)
      : { below: null, above: null };
  });

  const gexTopSup = () => gexSides().below;
  const gexTopRes = () => gexSides().above;
  const gexSupCopy = () => gexSideCopy(gexTopSup(), "below");
  const gexResCopy = () => gexSideCopy(gexTopRes(), "above");

  const gexRegime = () => {
    const current = report();
    return current?.gex
      ? gexRegimeAtSpot(current.gex, current.spot, current.gex.regime)
      : "flat";
  };

  const gexFlip = () => {
    const current = report();
    return current?.gex ? gexFlipAtSpot(current.gex, current.spot) : null;
  };

  const gexDegraded = createMemo(() => {
    const current = report();
    if (!current?.gex) return false;
    if (current.gex.degraded === true) return true;
    const strikes = current.strikes ?? [];
    if (strikes.length === 0) return false;
    const hasGamma = (value: number | null | undefined) =>
      typeof value === "number" && Number.isFinite(value);
    return !strikes.some((strike) => hasGamma(strike.ce.gamma) || hasGamma(strike.pe.gamma));
  });

  const gexForDisplay = () => (gexDegraded() ? undefined : report()?.gex);

  const pnlGreeks = createMemo<NiftyPnlGreeks[] | null>(() => {
    const current = report();
    if (!current) return null;
    const out: NiftyPnlGreeks[] = [];
    for (const strike of current.strikes ?? []) {
      out.push({
        opt: "CE",
        strike: strike.strike,
        ltp: strike.ce.ltp,
        delta: strike.ce.delta ?? null,
        iv: strike.ce.iv ?? null,
        theta: null,
        vega: null,
      });
      out.push({
        opt: "PE",
        strike: strike.strike,
        ltp: strike.pe.ltp,
        delta: strike.pe.delta ?? null,
        iv: strike.pe.iv ?? null,
        theta: null,
        vega: null,
      });
    }
    return out;
  });

  const formatGexSup = (strike: number) => formatGexLevel(strike, gexTopSup()?.netGex ?? 0);

  const formatGexRes = (strike: number) => formatGexLevel(strike, gexTopRes()?.netGex ?? 0);

  return (
    <Show when={!isDesk()}>
      <CompactPanel flush title="OI · tick tape" testId="nifty-tape-panel" style={TAPE_PANEL_STYLE}>
        <Show
          when={tape() && tapeRows().length > 0}
          fallback={
            <Text data-testid="nifty-tape-empty" size="sm" c="dimmed">
              Tape starts recording at next market open.
            </Text>
          }
        >
          <NiftyTapeTable
            rows={tapeRows()}
            tape={tape() ?? undefined}
            live={mode() === "live"}
            bursts={store.data.burstMap()}
            updatedAtMs={mode() === "live" ? updatedAtMs() : null}
            nextUpdateAtMs={nextUpdateAtMs()}
          />
        </Show>
      </CompactPanel>

      <Box
        data-testid="nifty-flow-row"
        className="grid grid-cols-1 min-[1200px]:grid-cols-2 gap-0 items-start w-full max-w-full min-w-0 shrink-0"
      >
        <Box className="min-w-0">
          <NiftyWallMigration rows={migrationRows()} />
        </Box>
        <Box className="min-w-0">
          <NiftyParticipantFlow rows={flowRows()} />
        </Box>
      </Box>

      <div
        data-testid="nifty-vol-row"
        class="grid grid-cols-1 gap-0 items-start w-full max-w-full min-w-0 shrink-0"
        classList={{ "min-[1200px]:grid-cols-2": mode() === "live" }}
      >
        <Box className="min-w-0">
          <NiftyVolumeProfile rows={volumeRows()} spot={report()?.spot ?? null} />
        </Box>
        <Show when={mode() === "live"}>
          <Box className="min-w-0">
            <NiftyPnlAttribution
              positions={store.data.pnlPositions()}
              greeks={pnlGreeks()}
              spot={report()?.spot ?? null}
            />
          </Box>
        </Show>
      </div>

      <Box
        data-testid="nifty-detail"
        className="border border-[var(--desk-border)] rounded-[4px] overflow-hidden w-full max-w-full min-w-0 shrink-0"
        style={DETAIL_STYLE}
      >
        <Button
          data-testid="nifty-detail-toggle"
          variant="subtle"
          size="sm"
          aria-expanded={store.ui.detailOpen()}
          aria-controls="nifty-detail-body"
          onClick={() => store.ui.toggleDetail()}
          className="w-full rounded-none normal-case gap-2 px-3 py-1"
          style={{ "justify-content": "space-between" }}
        >
          <Box className="flex items-baseline" style={DETAIL_HEAD_LEFT_STYLE}>
            <span style={DETAIL_HEAD_TITLE_STYLE}>Session detail</span>
            <span style={DETAIL_HEAD_SUB_STYLE}>
              Session forensics · OI bursts, structure, volume, levels, straddle, gamma, flow, P&amp;L
            </span>
          </Box>
          <span style={DETAIL_HEAD_ACTION_STYLE}>
            <Show when={store.ui.detailOpen()} fallback={"Show"}>
              Hide
            </Show>
          </span>
        </Button>

        <div
          id="nifty-detail-body"
          data-testid="nifty-detail-body"
          class="flex-col gap-1 p-1 border-t border-[var(--desk-border)] min-w-0"
          classList={{ flex: store.ui.detailOpen(), hidden: !store.ui.detailOpen() }}
        >
          <Box
            data-testid="nifty-gamma-iv-row"
            className="grid grid-cols-1 min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-0 w-full max-w-full min-w-0"
          >
            <Box className="min-w-0">
              <NiftyIvStraddle
                rows={tapeRows()}
                candles={report()?.candles}
                regime={report()?.regime}
                reference={report()?.reference}
              />
            </Box>
            <Box className="min-w-0">
              <NiftyGammaTime
                rows={tapeRows()}
                gex={gexForDisplay()}
                spot={report()?.spot ?? 0}
                walls={report()?.walls}
                degraded={gexDegraded()}
              />
            </Box>
          </Box>

          <Box
            data-testid="nifty-signals-grid"
            className="grid grid-cols-1 min-[1200px]:grid-cols-2 items-start gap-0 w-full max-w-full min-w-0"
          >
            <CompactPanel
              flush
              padded={false}
              testId="nifty-unusual-panel-wrap"
              style={UNUSUAL_PANEL_STYLE}
            >
              <NiftyUnusualVolume
                strikes={report()?.strikes ?? []}
                spot={report()?.spot ?? 0}
                updatedAtMs={mode() === "live" ? updatedAtMs() : null}
                nextUpdateAtMs={nextUpdateAtMs()}
              />
            </CompactPanel>

            <Show when={report()?.structure != null}>
              <Box
                data-testid="nifty-signals-row"
                className="flex min-[1200px]:contents flex-wrap items-stretch gap-1 min-w-0"
              >
                <NiftyStructureShifts structure={report()?.structure} />
              </Box>
            </Show>

            <Show
              when={report()?.gex}
              fallback={
                <CompactPanel
                  flush
                  title="Next-session levels"
                  testId="nifty-tomorrow-panel"
                  style={{ "min-width": 0 }}
                >
                  <Show when={levels()}>
                    <Box data-testid="nifty-levels-row">
                      <CompactStatGrid>
                        <For each={levels()?.resistance ?? []}>
                          {(level, i) => (
                            <CompactStat
                              dense
                              data-testid={`nifty-level-r${i() + 1}`}
                              label={i() === 0 ? "Resistance R1" : "Resistance R2"}
                              value={`${formatNumberIN(level.strike)} (${level.pct >= 0 ? "+" : ""}${level.pct.toFixed(2)}%)`}
                            />
                          )}
                        </For>
                        <CompactStat
                          dense
                          data-testid="nifty-level-pain"
                          label={`Max-pain pull ${levels()?.painPull.dir}`}
                          value={`${formatNumberIN(report()?.maxPain ?? 0)} (${(levels()?.painPull.pct ?? 0) >= 0 ? "+" : ""}${(levels()?.painPull.pct ?? 0).toFixed(2)}%)`}
                        />
                        <For each={levels()?.support ?? []}>
                          {(level, i) => (
                            <CompactStat
                              dense
                              data-testid={`nifty-level-s${i() + 1}`}
                              label={i() === 0 ? "Support S1" : "Support S2"}
                              value={`${formatNumberIN(level.strike)} (${level.pct.toFixed(2)}%)`}
                            />
                          )}
                        </For>
                      </CompactStatGrid>
                      <Text data-testid="nifty-levels-verdict" size="sm" c="dimmed">
                        {levels()?.pcrVerdict}. Gap above{" "}
                        {levels()?.resistance[0]?.strike != null
                          ? formatNumberIN(levels()!.resistance[0].strike)
                          : "—"}{" "}
                        squeezes call writers; acceptance below{" "}
                        {levels()?.support[0]?.strike != null
                          ? formatNumberIN(levels()!.support[0].strike)
                          : "—"}{" "}
                        opens the next put wall.
                      </Text>
                    </Box>
                  </Show>
                </CompactPanel>
              }
            >
              <CompactPanel
                flush
                title="GEX levels"
                testId="nifty-gex-panel"
                style={{ "min-width": 0 }}
              >
                <Box data-testid="nifty-gex-row">
                  <CompactStatGrid>
                    <CompactStat
                      dense
                      data-testid="nifty-gex-net"
                      label="Net GEX"
                      value={
                        <Show when={!gexDegraded()} fallback={"γ n/a"}>
                          <AnimatedValue
                            value={report()?.gex?.netTotal ?? 0}
                            format={formatGexTotalValue}
                          />
                        </Show>
                      }
                    />
                    <CompactStat
                      dense
                      data-testid="nifty-gex-regime"
                      label="Regime @ spot"
                      value={gexRegimeText(gexRegime())}
                    />
                    <CompactStat
                      dense
                      data-testid="nifty-gex-flip"
                      label="Gamma flip"
                      value={<AnimatedValue value={gexFlip() ?? 0} format={formatInt} />}
                    />
                    <CompactStat
                      dense
                      data-testid="nifty-gex-sup"
                      label={gexSupCopy().label}
                      value={
                        <Show when={gexTopSup()} fallback={"—"}>
                          {(sup) => (
                            <AnimatedValue value={sup().strike} format={formatGexSup} />
                          )}
                        </Show>
                      }
                    />
                    <CompactStat
                      dense
                      data-testid="nifty-gex-res"
                      label={gexResCopy().label}
                      value={
                        <Show when={gexTopRes()} fallback={"—"}>
                          {(res) => (
                            <AnimatedValue value={res().strike} format={formatGexRes} />
                          )}
                        </Show>
                      }
                    />
                  </CompactStatGrid>
                  <Text data-testid="nifty-gex-verdict" size="sm" c="dimmed">
                    {gexRegimeText(gexRegime())}
                    {levels()
                      ? ` — max-pain pull ${levels()!.painPull.dir} (${levels()!.painPull.pct >= 0 ? "+" : ""}${levels()!.painPull.pct.toFixed(2)}%). ${levels()!.pcrVerdict}.`
                      : "."}
                    {levels()?.resistance[0] && levels()?.support[0]
                      ? ` Gap above ${formatNumberIN(levels()!.resistance[0].strike)} squeezes call writers; acceptance below ${formatNumberIN(levels()!.support[0].strike)} opens the next put wall.`
                      : null}
                  </Text>
                </Box>
              </CompactPanel>
            </Show>
          </Box>

          <Box data-testid="nifty-levels-in-play" className="min-w-0">
            <LevelsInPlayContent report={report()} sensex={store.data.sensex()} />
          </Box>
        </div>
      </Box>
    </Show>
  );
}
