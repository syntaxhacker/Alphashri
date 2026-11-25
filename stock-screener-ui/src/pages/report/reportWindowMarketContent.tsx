import { createSignal, For, Match, Show, Switch } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { DockPanelApi } from "../../components/dock/types";
import type { NiftyStrike } from "@/types/niftyReport";
import { getNiftyOiColumns, NiftyOiChain } from "./reportCells";
import { NiftyFuturesPanel } from "./NiftyFuturesPanel";
import { NiftyItmPeFlowPanel } from "./NiftyItmPeFlow";
import { NiftyDeltaPositioning } from "./NiftyDeltaPositioning";
import { NiftyGexProfile } from "./NiftyGexProfile";
import { NiftyIvSkew } from "./NiftyIvSkew";
import { WINDOW_TITLE_SUPPRESSION_CLASS } from "./reportWindowDeskContent";
import type { ReportWindowContext } from "./reportWindowTypes";

export interface ReportWindowMarketContentProps {
  context: ReportWindowContext;
  api: DockPanelApi;
}

/**
 * The report desk used to point `chain`/`analytics` at the global options
 * registry. Those panels own their own broker token and paint the Upstox
 * reconnect notice, which is wrong here: the Index Report already carries a
 * live chain and its own analytics blocks on `context.reportStore`.
 */
function WindowNotice(props: {
  testId: string;
  state: "empty" | "loading";
  title: string;
  reason: string;
}) {
  return (
    <Box
      data-testid={props.testId}
      data-state={props.state}
      role="status"
      className="flex h-full min-h-0 w-full min-w-0 flex-col items-center justify-center gap-1 p-3 text-center"
    >
      <Text size="sm" fw={700} className="text-ui-label font-bold text-fin-text">
        {props.title}
      </Text>
      <Text size="xs" c="dimmed" className="text-ui-body">
        {props.reason}
      </Text>
    </Box>
  );
}

/** The monitor's own chain: OI + SIG columns, ATM/wall tint, one scroll owner. */
export function ReportChainWindow(
  props: ReportWindowMarketContentProps,
): JSX.Element {
  const store = () => props.context.reportStore;
  const strikes = () => store()?.data?.visibleStrikes?.() ?? [];
  const loading = () => store()?.data?.loading?.() ?? false;

  const state = () => {
    if (!store()) return "no-store" as const;
    if (strikes().length > 0) return "ready" as const;
    if (loading()) return "loading" as const;
    return "empty" as const;
  };

  const columns = () => {
    const current = store();
    if (!current) return [];
    const scale = current.data.oiScale?.() ?? {
      maxCeOiChange: 0,
      maxPeOiChange: 0,
    };
    return getNiftyOiColumns(current.data.atmStrike?.() ?? null, {
      maxCeOiChange: scale.maxCeOiChange,
      maxPeOiChange: scale.maxPeOiChange,
      spot: current.data.report?.()?.spot,
      walls: current.data.oiWalls?.() ?? undefined,
      showLegChange: false,
      hideSignals: false,
    });
  };

  const getRowStyle = (row: NiftyStrike): JSX.CSSProperties | undefined => {
    const atm = store()?.data?.atmStrike?.() ?? null;
    return atm !== null && row.strike === atm
      ? { "background-color": palette.alpha(palette.TERM_FLIP, 0.08) }
      : undefined;
  };

  const getRowTestId = (row: NiftyStrike): string | undefined => {
    const atm = store()?.data?.atmStrike?.() ?? null;
    return atm !== null && row.strike === atm
      ? "nifty-strike-atm"
      : `nifty-strike-row-${row.strike}`;
  };

  return (
    <Box
      data-testid="report-chain-window"
      data-scroll-owner="frame"
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden ${WINDOW_TITLE_SUPPRESSION_CLASS}`}
    >
      <Switch>
        <Match when={state() === "no-store"}>
          <WindowNotice
            testId="report-chain-window-empty"
            state="empty"
            title="Options chain unavailable"
            reason="Report store not connected — open the Index Report shell to load the chain."
          />
        </Match>
        <Match when={state() === "loading"}>
          <WindowNotice
            testId="report-chain-window-loading"
            state="loading"
            title="Loading option chain"
            reason="Waiting for the report's first OI snapshot."
          />
        </Match>
        <Match when={state() === "empty"}>
          <WindowNotice
            testId="report-chain-window-empty"
            state="empty"
            title="No strikes for this expiry"
            reason="The report has no option chain for the selected expiry."
          />
        </Match>
        <Match when={state() === "ready"}>
          <NiftyOiChain
            strikes={strikes()}
            columns={columns()}
            getRowStyle={getRowStyle}
            getRowTestId={getRowTestId}
            panelTestId="nifty-oi-panel"
            tableTestId="nifty-oi-table"
            wrapTestId="nifty-oi-wrap"
            onExpand={props.api.commands.onExpand}
          />
        </Match>
      </Switch>
    </Box>
  );
}

type AnalyticsTab = "futures" | "itm" | "positioning" | "gex" | "iv";

const ANALYTICS_TABS: ReadonlyArray<{ key: AnalyticsTab; label: string }> = [
  { key: "futures", label: "FUTURES" },
  { key: "itm", label: "ITM PE" },
  { key: "positioning", label: "DELTA" },
  { key: "gex", label: "GEX" },
  { key: "iv", label: "IV SKEW" },
];

const ANALYTICS_HEADER_STYLE: JSX.CSSProperties = {
  "background-color": palette.TERM_HEADER,
  "border-bottom": `1px solid ${palette.TERM_BORDER}`,
};

/**
 * The shared Button transitions background-color over 150ms. A selection tab
 * is a state indicator, not a decorative animation: mid-transition the old tab
 * keeps its filled colour while the new panel is already on screen. Suppress
 * the transition so the fill changes in the same frame as `aria-pressed`.
 */
const ANALYTICS_TAB_STYLE: JSX.CSSProperties = { "transition-property": "none" };

/** The report's own analytics blocks, tabbed — no broker-auth placeholder. */
export function ReportAnalyticsWindow(
  props: ReportWindowMarketContentProps,
): JSX.Element {
  const [tab, setTab] = createSignal<AnalyticsTab>("futures");
  const store = () => props.context.reportStore;
  const report = () => store()?.data?.report?.() ?? null;
  const loading = () => store()?.data?.loading?.() ?? false;

  const hasAnalytics = () => {
    const current = report();
    if (!current) return false;
    return Boolean(
      current.futures ||
        current.itm_pe_flow ||
        current.positioning ||
        current.gex ||
        current.iv_surface ||
        (current.strikes?.length ?? 0) > 0,
    );
  };

  const state = () => {
    if (!store()) return "no-store" as const;
    if (hasAnalytics()) return "ready" as const;
    if (loading()) return "loading" as const;
    return "empty" as const;
  };

  return (
    <Box
      data-testid="report-analytics-window"
      data-scroll-owner="frame"
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden ${WINDOW_TITLE_SUPPRESSION_CLASS}`}
    >
      <Switch>
        <Match when={state() === "no-store"}>
          <WindowNotice
            testId="report-analytics-window-empty"
            state="empty"
            title="Options analytics unavailable"
            reason="Report store not connected — open the Index Report shell to load analytics."
          />
        </Match>
        <Match when={state() === "loading"}>
          <WindowNotice
            testId="report-analytics-window-loading"
            state="loading"
            title="Loading options analytics"
            reason="Waiting for the report's positioning payload."
          />
        </Match>
        <Match when={state() === "empty"}>
          <WindowNotice
            testId="report-analytics-window-empty"
            state="empty"
            title="No options analytics"
            reason="The report has no futures, flow, gamma or volatility block yet."
          />
        </Match>
        <Match when={state() === "ready"}>
          <Box
            data-testid="report-analytics-tabs"
            className="flex shrink-0 flex-wrap items-center gap-1 px-1 py-1"
            style={ANALYTICS_HEADER_STYLE}
          >
            <For each={ANALYTICS_TABS}>
              {(item) => (
                <Button
                  data-testid={`report-analytics-tab-${item.key}`}
                  size="sm"
                  variant={tab() === item.key ? "filled" : "subtle"}
                  aria-pressed={tab() === item.key}
                  style={ANALYTICS_TAB_STYLE}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </Button>
              )}
            </For>
            <Show when={props.api.commands.onExpand}>
              <Button
                data-testid="report-analytics-expand"
                size="sm"
                variant="subtle"
                aria-label="Expand options analytics"
                title="Expand options analytics"
                className="min-w-[22px] px-1 leading-none text-ui-micro"
                onClick={() => props.api.commands.onExpand?.()}
              >
                ⤢
              </Button>
            </Show>
          </Box>
          {/* One scroll owner: the active report panel's own body. The adapter
              frame and this flex slot only clip, they never scroll. */}
          <Box className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Switch>
              <Match when={tab() === "futures"}>
                <NiftyFuturesPanel futures={report()?.futures ?? null} />
              </Match>
              <Match when={tab() === "itm"}>
                <NiftyItmPeFlowPanel
                  flow={report()?.itm_pe_flow ?? null}
                  spot={report()?.spot ?? 0}
                />
              </Match>
              <Match when={tab() === "positioning"}>
                <NiftyDeltaPositioning
                  positioning={report()?.positioning}
                  spot={report()?.spot ?? null}
                />
              </Match>
              <Match when={tab() === "gex"}>
                <NiftyGexProfile gex={report()?.gex} spot={report()?.spot ?? 0} />
              </Match>
              <Match when={tab() === "iv"}>
                <NiftyIvSkew
                  strikes={report()?.strikes}
                  spot={report()?.spot ?? null}
                  ivSurface={report()?.iv_surface}
                />
              </Match>
            </Switch>
          </Box>
        </Match>
      </Switch>
    </Box>
  );
}
