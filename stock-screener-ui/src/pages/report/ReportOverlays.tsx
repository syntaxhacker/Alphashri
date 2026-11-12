import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { hexToRgba } from "@/utils/color";
import { PanelModal } from "@/components/common/PanelModal";
import { useNiftyReport } from "./ReportContext";
import { NiftyDeskPlan } from "./NiftyDeskPlan";
import { NiftyGammaStrip } from "./NiftyGammaStrip";
import { NiftyGexProfile } from "./NiftyGexProfile";
import { NiftyDeltaPositioning } from "./NiftyDeltaPositioning";
import { NiftyChartPanel } from "./NiftyChartPanel";
import { NiftyIvSkew } from "./NiftyIvSkew";
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
