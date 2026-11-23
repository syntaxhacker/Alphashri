import { Match, Show, Switch, createEffect, on, untrack } from "solid-js";
import { Box as UiBox, Text as UiText } from "@/ui";
import type { ChainRow } from "@/api/optionsDock";
import type { DockLeg } from "@/state/optionsDock";
import { loadAnalytics, optionsAnalyticsState, refreshAnalytics } from "@/state/optionsAnalytics";
import type { AnalyticsTab } from "./types";
import {
  AnalyticsTabStrip,
  type AnalyticsExpiryOption,
  type AnalyticsStripContext,
} from "./AnalyticsTabStrip";
import { ProbPanel } from "./ProbPanel";
import { SmilePanel } from "./SmilePanel";
import { SurfacePanel } from "./SurfacePanel";
import { TermPanel } from "./TermPanel";

export type AnalyticsContentTab = Exclude<AnalyticsTab, "payoff">;

function LoadingSkeleton() {
  return (
    <UiBox
      className="flex min-h-0 flex-1 flex-col items-stretch justify-center gap-2 px-2"
      data-testid="analytics-loading"
    >
      <UiBox
        aria-hidden="true"
        className="h-2 w-2/3"
        style={{ "border-radius": "2px", "background-color": "var(--color-fin-surface-alt)" }}
      />
      <UiBox
        aria-hidden="true"
        className="h-2 w-1/2"
        style={{ "border-radius": "2px", "background-color": "var(--color-fin-surface-alt)" }}
      />
      <UiText size="xs" c="dimmed" className="font-mono uppercase" style={{ "font-size": "9px" }}>
        Loading analytics
      </UiText>
    </UiBox>
  );
}

/**
 * The lazy analytics body. Mounted only on a non-payoff tab, so opening or
 * polling the dock never fetches: the first activation fetches once per symbol
 * and the store's LRU serves every later open.
 *
 * SMILE and PROB are chain-only and paint while the request is still in flight;
 * TERM and SURFACE need the analytics payload. The strip owns the shared shell
 * (context, verdicts, expiry picker and help) for every analytics tab.
 */
export function AnalyticsPanel(props: {
  tab: AnalyticsContentTab;
  symbol: string;
  rows: ChainRow[];
  spot: number;
  atmIv: number | null;
  legs: DockLeg[];
  selectedExpiry: string | null;
  dteYears: number;
  onHeadline?: (headline: string) => void;
  onTabChange?: (tab: AnalyticsTab) => void;
  headline?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  context?: AnalyticsStripContext;
  maxPain?: number | null;
  expiryOptions?: AnalyticsExpiryOption[];
  onSelectExpiry?: (date: string) => void;
  /** Opens the in-dock pillars view; forwarded to the strip. */
  onOpenPillars?: () => void;
  /** Host-owned help popover state, so a strip swap cannot silently close it. */
  helpOpen?: boolean;
  onHelpOpenChange?: (open: boolean) => void;
}) {
  createEffect(() => {
    const symbol = props.symbol;
    untrack(() => void loadAnalytics(symbol));
  });

  createEffect(
    on(
      () => optionsAnalyticsState.data,
      (data) => {
        if (data) props.onHeadline?.(`${data.symbol} · ${data.expiries.length} expiries`);
      },
    ),
  );

  const data = () => optionsAnalyticsState.data;
  const ready = () => optionsAnalyticsState.status === "ready" && data() != null;

  return (
    <UiBox className="flex min-h-0 flex-1 flex-col" data-testid="analytics-panel">
      <AnalyticsTabStrip
        value={props.tab}
        onChange={(tab) => props.onTabChange?.(tab)}
        headline={props.headline}
        onRefresh={props.onRefresh}
        refreshing={props.refreshing}
        context={props.context}
        data={data()}
        maxPain={props.maxPain}
        expiryOptions={props.expiryOptions}
        selectedExpiry={props.selectedExpiry}
        onSelectExpiry={props.onSelectExpiry}
        symbol={props.symbol}
        onOpenPillars={props.onOpenPillars}
        helpOpen={props.helpOpen}
        onHelpOpenChange={props.onHelpOpenChange}
      />
      <Show when={optionsAnalyticsState.status === "error"}>
        <UiBox
          className="flex h-[26px] shrink-0 items-center gap-2 border-l-[3px] bg-fin-surface-alt px-2"
          style={{ "border-left-color": "var(--color-fin-negative)" }}
          data-testid="analytics-error"
        >
          <UiText
            size="xs"
            className="min-w-0 flex-1 truncate font-mono"
            style={{ "font-size": "10px", color: "var(--color-fin-negative)" }}
          >
            {optionsAnalyticsState.error?.message ?? "Could not load the options analytics"}
          </UiText>
          <UiBox
            component="button"
            type="button"
            aria-label="Retry analytics"
            data-testid="analytics-retry"
            onClick={() => void refreshAnalytics()}
            className="inline-flex h-[20px] shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 font-mono text-[10px] font-semibold hover:underline"
            style={{ color: "var(--color-fin-negative)" }}
          >
            Retry
          </UiBox>
        </UiBox>
      </Show>

      <Switch>
        <Match when={props.tab === "smile"}>
          <SmilePanel
            rows={props.rows}
            spot={props.spot}
            atmIv={props.atmIv}
            legs={props.legs}
            bf25={data()?.expiries.find((expiry) => expiry.date === props.selectedExpiry)?.bf25 ?? null}
            data={data()}
          />
        </Match>
        <Match when={props.tab === "prob"}>
          <ProbPanel
            legs={props.legs}
            spot={props.spot}
            iv={props.atmIv}
            dteYears={props.dteYears}
            data={data()}
          />
        </Match>
        <Match when={!ready()}>
          <LoadingSkeleton />
        </Match>
        <Match when={props.tab === "term"}>
          <TermPanel data={data()!} selectedExpiry={props.selectedExpiry} />
        </Match>
        <Match when={props.tab === "surface"}>
          <SurfacePanel data={data()!} selectedExpiry={props.selectedExpiry} />
        </Match>
      </Switch>
    </UiBox>
  );
}
