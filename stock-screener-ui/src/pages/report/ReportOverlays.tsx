import { For, Show, createMemo } from "solid-js";
import type { ComponentProps, JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { hexToRgba } from "@/utils/color";
import { formatNumberIN } from "@/utils/ui-helpers";
import { PanelModal } from "@/components/common/PanelModal";
import { useNiftyReport } from "./ReportContext";
import { NiftyDeskPlan } from "./NiftyDeskPlan";
import { NiftyGammaStrip } from "./NiftyGammaStrip";
import { NiftyGexProfile } from "./NiftyGexProfile";
import { NiftyDeltaPositioning } from "./NiftyDeltaPositioning";
import { NiftyChartPanel } from "./NiftyChartPanel";
import { NiftyIvSkew } from "./NiftyIvSkew";
import { NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { NiftyFlowStrip } from "./NiftyFlowStrip";
import { NiftyPressureLane } from "./NiftyPressureLane";
import { NiftyFlowChart } from "./NiftyFlowChart";
import { buildFlowSeries } from "./niftyFlowSeries";
import { NiftyOiChain, getNiftyOiColumns } from "./reportCells";
import type { NiftyStrike } from "@/types/niftyReport";

const TF_OPTIONS = ["1m", "5m", "15m"] as const;

export function ReportOverlays() {
  const store = useNiftyReport();
  const ui = store.ui;

  const oiColumns = () => {
    const scale = store.data.oiScale();
    return getNiftyOiColumns(store.data.atmStrike(), {
      maxCeOiChange: scale.maxCeOiChange,
      maxPeOiChange: scale.maxPeOiChange,
      spot: store.data.report()?.spot,
      walls: store.data.oiWalls(),
      showLegChange: !ui.isDesk(),
    });
  };

  const getOiRowStyle = (row: NiftyStrike): JSX.CSSProperties | undefined => {
    const atm = store.data.atmStrike();
    return atm !== null && row.strike === atm
      ? { background: hexToRgba(palette.TERM_FLIP, 0.08) }
      : undefined;
  };

  const getOiRowTestId = (row: NiftyStrike): string | undefined => {
    const atm = store.data.atmStrike();
    return atm !== null && row.strike === atm ? "nifty-strike-atm" : "nifty-strike-row";
  };

  const pressureRange = () => store.data.pressure();
  const flowSeries = createMemo(() => buildFlowSeries(store.data.tapeRows()));
  const heatRows = () =>
    store.data.tapeRows() as unknown as ComponentProps<typeof NiftyOiHeatmap>["rows"];

  return (
    <>
      <PanelModal
        open={ui.planOpen()}
        title="Desk plan — reasons"
        onClose={() => ui.setPlanOpen(false)}
        variant="drawer"
      >
        <Box data-testid="nifty-plan-modal">
          <Show when={store.data.report()}>
            {(current) => <NiftyDeskPlan report={current()} />}
          </Show>
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.gammaOpen()}
        title="Dealer gamma & positioning"
        onClose={() => ui.setGammaOpen(false)}
        variant="drawer"
      >
        <Box
          data-testid="nifty-gamma-cell"
          style={{
            "--desk-border": palette.TERM_BORDER,
            "--desk-header": palette.TERM_HEADER,
            "--desk-muted": palette.TEXT_MUTED,
          }}
        >
          <Show when={store.data.report()}>
            {(current) => (
              <>
                <NiftyGammaStrip
                  gex={current().gex}
                  positioning={current().positioning}
                  spot={current().spot}
                />
                <NiftyGexProfile gex={current().gex} spot={current().spot} />
                <NiftyDeltaPositioning positioning={current().positioning} spot={current().spot} />
              </>
            )}
          </Show>
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.chartFull()}
        title={
          <Box
            data-testid="nifty-chart-fullscreen-titlebar"
            className="flex items-center gap-1 w-full min-w-0"
          >
            <span
              style={{
                flex: 1,
                "min-width": "0px",
                "font-size": "10px",
                "font-weight": 700,
                "letter-spacing": "0.08em",
                color: palette.TEXT_MUTED,
                "white-space": "nowrap",
                overflow: "hidden",
                "text-overflow": "ellipsis",
              }}
            >
              {store.selection.symbol()} CHART — FULLSCREEN
            </span>
            <For each={TF_OPTIONS}>
              {(tf) => (
                <Button
                  data-testid={`nifty-chart-fullscreen-tf-${tf}`}
                  size="sm"
                  variant={ui.chartTf() === tf ? "filled" : "subtle"}
                  aria-pressed={ui.chartTf() === tf}
                  onClick={() => ui.handleChartTf(tf)}
                  style={{
                    "min-width": "34px",
                    "padding-left": "6px",
                    "padding-right": "6px",
                    "padding-top": "0px",
                    "padding-bottom": "0px",
                    "font-size": "10px",
                    "line-height": 1.6,
                  }}
                >
                  {tf}
                </Button>
              )}
            </For>
          </Box>
        }
        onClose={() => ui.setChartFull(false)}
      >
        <Box
          data-testid="nifty-chart-fullscreen-body"
          className="flex flex-col gap-1 min-h-0 h-full"
        >
          <Box
            data-testid="nifty-chart-fullscreen-chart"
            className="flex-auto min-h-0 min-w-0 w-full flex [&>*]:flex-1 [&>*]:min-w-0 [&>*]:min-h-0"
          >
            <Show when={store.data.report()}>
              {(current) => (
                <NiftyChartPanel
                  report={current()}
                  bursts={store.data.effectiveBursts()}
                  tape={store.data.tape()}
                  spotPoints={store.data.oiPoints()}
                  flipAt={store.data.flipAt()}
                  maxWalls={
                    store.walls.data()
                      ? { calls: store.walls.data()!.calls, puts: store.walls.data()!.puts }
                      : null
                  }
                  mode={store.selection.mode()}
                  view={ui.view()}
                  symbol={store.selection.symbol()}
                  asOf={store.replay.frameT() ?? undefined}
                  timeframe={ui.chartTf()}
                  onTimeframeChange={(tf) => ui.handleChartTf(tf)}
                  fillContainer
                />
              )}
            </Show>
          </Box>
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.oiExpand()}
        variant="drawer"
        title="Option chain — expanded"
        onClose={() => ui.setOiExpand(false)}
      >
        <Box data-testid="nifty-oi-expanded-body" className="h-[78vh] flex min-h-0">
          <NiftyOiChain
            strikes={store.data.visibleStrikes()}
            columns={oiColumns()}
            getRowStyle={getOiRowStyle}
            getRowTestId={getOiRowTestId}
            panelTestId="nifty-oi-expanded"
            tableTestId="nifty-oi-expanded-table"
            wrapTestId="nifty-oi-expanded-wrap"
          />
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.heatExpand()}
        variant="drawer"
        title="OI heatmap — expanded"
        onClose={() => ui.setHeatExpand(false)}
      >
        <Box data-testid="nifty-heatmap-expanded-body" className="h-[78vh] flex min-h-0">
          <NiftyOiHeatmap
            rows={heatRows()}
            viewBoxHeight={380}
            metric={ui.heatMetric()}
            gex={store.data.report()?.gex}
            spot={store.data.report()?.spot ?? null}
          />
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.flowExpand()}
        variant="drawer"
        title="Flow strip — expanded"
        onClose={() => ui.setFlowExpand(false)}
        autoHeight
      >
        <Box data-testid="nifty-flow-expanded-body" className="w-full min-w-0">
          <NiftyFlowStrip rows={store.data.tapeRows()} />
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.pressureExpand()}
        variant="drawer"
        title="Option volume pressure — expanded"
        onClose={() => ui.setPressureExpand(false)}
        autoHeight
      >
        <Box data-testid="nifty-pressure-expanded-body" className="flex flex-col gap-2 min-h-0">
          <Box
            data-testid="nifty-pressure-expanded-stats"
            className="flex gap-2 flex-wrap text-[10px] text-fin-text-muted"
          >
            <span>median {formatNumberIN(Math.round(pressureRange().median))}</span>
            <span>peak {pressureRange().maxRatio.toFixed(1)}×</span>
            <span>{pressureRange().bursts} minutes ≥2×</span>
            <span>last {pressureRange().lastRatio.toFixed(1)}×</span>
            <span>last 3-min {pressureRange().last3Ratio.toFixed(1)}×</span>
          </Box>
          <Box className="flex-1 min-h-0 flex items-stretch">
            <NiftyPressureLane series={pressureRange()} height={420} showAxis />
          </Box>
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.flowChartExpand()}
        variant="drawer"
        title="Cumulative flow + gamma — expanded"
        onClose={() => ui.setFlowChartExpand(false)}
        autoHeight
      >
        <Box data-testid="nifty-flowchart-expanded-body" className="flex flex-col gap-2 min-w-0">
          <Box
            data-testid="nifty-flowchart-expanded-stats"
            className="flex gap-2 flex-wrap text-[10px] text-fin-text-muted"
          >
            <span>
              flow{" "}
              {flowSeries().points.length
                ? `${(flowSeries().points[flowSeries().points.length - 1].net / 1e6).toFixed(1)}M`
                : "—"}
            </span>
            <span>{flowSeries().flips.length} regime flips</span>
            <span>{Math.round(flowSeries().shortShare * 100)}% short book Γ</span>
            <span>{flowSeries().points.length} buckets</span>
          </Box>
          <NiftyFlowChart series={flowSeries()} height={420} showAxis />
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.ivOpen()}
        title="IV skew — expanded"
        onClose={() => ui.setIvOpen(false)}
      >
        <Box data-testid="nifty-ivskew-modal">
          <Show when={store.data.report()}>
            {(current) => <NiftyIvSkew strikes={current().strikes} spot={current().spot} />}
          </Show>
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.gexOpen()}
        title="GEX profile — expanded"
        onClose={() => ui.setGexOpen(false)}
      >
        <Box data-testid="nifty-gex-modal">
          <Show when={store.data.report()}>
            {(current) => <NiftyGexProfile gex={current().gex} spot={current().spot} />}
          </Show>
        </Box>
      </PanelModal>

      <PanelModal
        open={ui.visualsOpen()}
        title="Visuals grid"
        onClose={() => ui.setVisualsOpen(false)}
      >
        <Text data-testid="nifty-visuals-stub" size="sm" c="dimmed">
          Visuals grid coming soon — press V to toggle this stub.
        </Text>
      </PanelModal>
    </>
  );
}
