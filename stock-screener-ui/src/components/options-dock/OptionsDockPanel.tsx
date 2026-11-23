import {
  For,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  useContext,
  type JSX,
} from "solid-js";
import { RouterContext } from "@solidjs/router";
import { ActionIcon, Box, Button, Modal, Text, Tooltip, useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconRefresh,
  IconRotate,
  IconTarget,
  IconX,
} from "@/components/common/Icons";
import type { SortEntry } from "@/components/common/TanStackTable";
import { EmptyState } from "@/components/common/states";
import { formatPercentage } from "@/utils/ui-helpers";
import { DERIVATIVES_CLOSE_MIN, istClock } from "@/utils/marketClock";
import { isMarketOpenNow } from "@/state/holidays";
import {
  optionsDockState,
  addLeg,
  close,
  setExpiry,
  refresh,
  netPremium,
  resumePolling,
  suspendPolling,
} from "@/state/optionsDock";
import type { ChainLeg } from "@/api/optionsDock";
import type { ContractChartSelection } from "./contract/ContractChartPanel";
import {
  CHAIN_NARROW_QUERY,
  DEFAULT_CHAIN_SORTING,
  OptionChainTable,
} from "./OptionChainTable";
import { LegBuilder } from "./LegBuilder";
import { StrategyControl } from "./StrategyControl";
import { PayoffPanel } from "./PayoffPanel";
import { SummaryStrip, formatDte } from "./SummaryStrip";
import { DockSection } from "./DockSection";
import { AnalyticsTabStrip } from "./analytics/AnalyticsTabStrip";
import type { AnalyticsStripContext } from "./analytics/AnalyticsTabStrip";
import type { AnalyticsContentTab } from "./analytics/AnalyticsPanel";
import type { AnalyticsTab } from "./analytics/types";
import {
  abortAnalytics,
  refreshAnalytics,
  optionsAnalyticsState,
} from "@/state/optionsAnalytics";
import { PaperOrderBand } from "@/components/options-paper/PaperOrderBand";
import { OptionPositionsPanel } from "@/components/options-paper/OptionPositionsPanel";
import { useStoreSnapshot } from "@/hooks/useStoreSubscription";
import {
  getOptionsPaperState,
  subscribe as subscribeOptionsPaper,
} from "@/state/optionsPaper";
import { formatSignedPnl } from "@/utils/ui-helpers";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * PAYOFF keeps its original slot. A chart tab also carries the smile chrome
 * (18px caption + 16px wings + 24px footer = 58px), so at 206px its 96px plot
 * did not fit and the footer was clipped. The taller band is bounded so a tall
 * monitor does not hand the dock's whole column to one chart.
 */
export const PAYOFF_BAND_HEIGHT = "206px";
export const CHART_BAND_HEIGHT = "clamp(320px, 42vh, 400px)";

/** The band height for a tab; maximized docks ignore it and fill instead. */
export function bandHeight(tab: AnalyticsTab): string {
  return tab === "payoff" ? PAYOFF_BAND_HEIGHT : CHART_BAND_HEIGHT;
}

// The analytics bundle is fetched on the first non-payoff tab, never on open.
const AnalyticsPanel = lazy(() =>
  import("./analytics/AnalyticsPanel").then((module) => ({ default: module.AnalyticsPanel })),
);

// The four pillars pull ECharts; keep them out of the dock's own chunk.
const DockPillarsView = lazy(() =>
  import("./analytics/DockPillarsView").then((module) => ({ default: module.DockPillarsView })),
);

// Contract charts pull a chart engine too, so they stay out of the chain chunk.
const ContractChartPanel = lazy(() =>
  import("./contract/ContractChartPanel").then((module) => ({ default: module.ContractChartPanel })),
);

/** What the chain hands the chart: the contract itself, not a leg. */
export type ContractChartTarget = ContractChartSelection;

/** `2026-03-26` → `26 MAR`. */
function shortDate(date: string): string {
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  const month = MONTHS[Number(parts[1]) - 1] ?? parts[1];
  return `${parts[2]} ${month}`;
}

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type DockFailure = { kind: string; message: string };

/**
 * A failed refresh keeps the last chain painted and stores the typed failure in
 * `error` while `status` stays `ready`. The banner wording mirrors the cold
 * panel for `auth`, and adds the two cases that only arise once a chain exists.
 */
function bannerMessage(error: DockFailure, retrySeconds: number): string {
  switch (error.kind) {
    case "auth":
      return "Reconnect Upstox in Settings";
    case "rate":
    case "rate_limited":
      return retrySeconds > 0
        ? `Refreshing paused — retry in ${retrySeconds} s`
        : "Refreshing paused — rate limited";
    case "not_fno":
      return "No listed options";
    default:
      return error.message;
  }
}

function bannerColor(error: DockFailure): string {
  return error.kind === "rate" || error.kind === "rate_limited" || error.kind === "not_fno"
    ? "var(--color-fin-warning)"
    : "var(--color-fin-negative)";
}

/**
 * `26 MAR · 2d`, `26 MAR · 0-DTE`, `26 MAR · EXPIRED`.
 *
 * EXPIRED is a label, not a filter: today's contract stays selectable after the
 * derivatives close, it just isn't where the dock lands.
 */
export function expiryLabel(
  expiry: { date: string; dteDays: number },
  now: Date = new Date(),
): string {
  const base = shortDate(expiry.date);
  const expiredToday =
    expiry.date === istToday() && istClock(now).minutes >= DERIVATIVES_CLOSE_MIN;
  if (expiry.date < istToday() || expiredToday) return `${base} · EXPIRED`;
  if (expiry.dteDays <= 0) return `${base} · 0-DTE`;
  return `${base} · ${expiry.dteDays}d`;
}

/** Calendar-year T convention, floored at 15 minutes (never negative). */
function dteYearsOf(expiryDate: string | null, now: Date = new Date()): number {
  const MIN = 15 / (365 * 24 * 60);
  if (!expiryDate) return MIN;
  const close = new Date(`${expiryDate}T15:30:00+05:30`);
  if (Number.isNaN(close.getTime())) return MIN;
  const years = (close.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000);
  return Number.isFinite(years) && years > MIN ? years : MIN;
}

function spotMoveColor(value: number | null): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  // Theme tokens, not palette hexes: the light-mode negative must stay readable.
  if (value > 0) return "var(--color-fin-positive)";
  if (value < 0) return "var(--color-fin-negative)";
  return undefined;
}

/**
 * The paper-order slot calls `useNavigate()` while rendering. A dock mounted
 * outside a Router (unit tests, embedded previews) has no router context, so that
 * call throws and takes the whole panel down. With a real Router ancestor this
 * is a pass-through; only context-less hosts get an in-memory navigator.
 */
const NO_ROUTER = { navigatorFactory: () => () => undefined };

function WithRouterFallback(props: { children: JSX.Element }) {
  return useContext(RouterContext) ? (
    (props.children as JSX.Element)
  ) : (
    <RouterContext.Provider value={NO_ROUTER as never}>{props.children}</RouterContext.Provider>
  );
}

/** One-sided chain picker for the <640px sheet. Native buttons keep keyboard parity. */
function ChainSideToggle(props: {
  value: "CE" | "PE";
  onChange: (side: "CE" | "PE") => void;
}) {
  const items: { side: "CE" | "PE" }[] = [{ side: "CE" }, { side: "PE" }];
  return (
    <Box
      role="group"
      aria-label="Option chain side"
      className="inline-flex h-6 shrink-0 items-stretch overflow-hidden rounded-fin border border-fin-border-default"
    >
      <For each={items}>
        {(item) => (
          <button
            type="button"
            aria-pressed={props.value === item.side}
            data-testid={`options-chain-side-${item.side.toLowerCase()}`}
            onClick={() => props.onChange(item.side)}
            className={`inline-flex h-full min-w-8 cursor-pointer items-center justify-center border-0 px-2 font-mono text-[11px] font-bold leading-[14px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary ${
              props.value === item.side
                ? "bg-fin-surface-alt text-fin-text"
                : "bg-transparent text-fin-text-muted"
            }`}
          >
            {item.side}
          </button>
        )}
      </For>
    </Box>
  );
}

/** The dock's `options` mode content. */
export function OptionsDockPanel(props: { onClose?: () => void }) {
  const [maximized, setMaximized] = createSignal(false);
  const [now, setNow] = createSignal(new Date());
  const isNarrow = useMediaQuery(CHAIN_NARROW_QUERY);
  const [chainSide, setChainSide] = createSignal<"CE" | "PE">("CE");
  const [chainSorting, setChainSorting] = createSignal<SortEntry[]>([...DEFAULT_CHAIN_SORTING]);
  // Bumping this asks OptionChainTable to re-enable follow and re-centre the ATM
  // row — the escape hatch when a user has scrolled away manually.
  const [chainCenterNonce, setChainCenterNonce] = createSignal(0);
  const [analyticsTab, setAnalyticsTab] = createSignal<AnalyticsTab>("payoff");
  const [analyticsHeadline, setAnalyticsHeadline] = createSignal("");
  // The help popover belongs to the dock, not to a strip instance: adding a leg
  // swaps the placeholder strip for the band's strip, and a poll that empties a
  // preset's legs swaps it back. Without this the popover silently closes.
  const [analyticsHelpOpen, setAnalyticsHelpOpen] = createSignal(false);
  // The pillars replace the chain in place; they never navigate to the
  // standalone dashboard route, so the dock (and its legs) stay put.
  const [pillarsOpen, setPillarsOpen] = createSignal(false);
  const [contractChart, setContractChart] = createSignal<ContractChartTarget | null>(null);
  const [positionsOpen, setPositionsOpen] = createSignal(false);
  const paperState = useStoreSnapshot(subscribeOptionsPaper, getOptionsPaperState);
  let restoreMaximize = false;
  /** Set for exactly one maximize transition, so entering pillars does not
   * capture the strip button as the generic restore target (it is detached). */
  let enteringPillars = false;
  let pillarsTrigger: HTMLElement | null = null;
  // Same contract for the chart: the chain button detaches with the chain.
  let enteringContract = false;
  let restoreMaximizeContract = false;

  const openPillars = () => {
    if (pillarsOpen()) return;
    // The strip is about to unmount with the rest of the body, so remember who
    // opened the view instead of letting the maximize effect read `<body>`.
    pillarsTrigger = document.activeElement as HTMLElement | null;
    enteringPillars = true;
    // Charts need the room; restore the previous dock size on the way back.
    restoreMaximize = maximized();
    setAnalyticsHeadline("");
    setPillarsOpen(true);
    setMaximized(true);
    // The chain is hidden; polling it would spend the options slice on a table
    // nobody can see.
    suspendPolling();
  };

  const closePillars = () => {
    const restore = restoreMaximize;
    restoreMaximize = false;
    setPillarsOpen(false);
    setMaximized(restore);
    resumePolling();
    // Solid has already re-rendered the body by now; the same button the user
    // pressed is back, and focus must land on it rather than on the body.
    const trigger =
      document.querySelector<HTMLElement>('[data-testid="analytics-pillars-open"]') ?? pillarsTrigger;
    trigger?.focus?.({ preventScroll: true });
    pillarsTrigger = null;
  };

  // A stale summary must not survive a tab switch: the new tab owns its read.
  const selectAnalyticsTab = (tab: AnalyticsTab) => {
    setAnalyticsHeadline("");
    setAnalyticsTab(tab);
  };

  // Maximize a11y state: the element that had focus when maximize was opened,
  // the scroll owners' overflow values we temporarily replace, and whether we
  // are maximized (so the effect only acts on transitions, not every
  // store-driven re-render).
  let restoreTarget: HTMLElement | null = null;
  let previousOverflow = "";
  let previousMainOverflow = "";
  let wasMaximized = false;

  /**
   * The page has two scrollers: `<body>` and the layout's `#app-main`. Locking
   * only the body left the real scroller live behind the maximized dock.
   */
  const setScrollLock = (locked: boolean) => {
    const main = document.getElementById("app-main");
    if (locked) {
      previousOverflow = document.body.style.overflow;
      previousMainOverflow = main?.style.overflow ?? "";
      document.body.style.overflow = "hidden";
      if (main) main.style.overflow = "hidden";
      return;
    }
    document.body.style.overflow = previousOverflow;
    if (main) main.style.overflow = previousMainOverflow;
  };

  const isStrikeOrder = () => {
    const sort = chainSorting();
    return (
      sort.length === 1 &&
      sort[0].id === DEFAULT_CHAIN_SORTING[0].id &&
      sort[0].desc === DEFAULT_CHAIN_SORTING[0].desc
    );
  };

  // The 0-DTE / EXPIRED labels cross a boundary at 15:40; a 30 s clock is
  // enough to relabel without waking up per frame. A live 429 swaps in a 1 s
  // clock so its countdown actually counts instead of repeating the first value.
  let clockTimer: number | undefined;
  createEffect(() => {
    const interval = optionsDockState.paused ? 1_000 : 30_000;
    if (clockTimer != null) window.clearInterval(clockTimer);
    setNow(new Date());
    clockTimer = window.setInterval(() => setNow(new Date()), interval);
  });
  onCleanup(() => {
    if (clockTimer != null) window.clearInterval(clockTimer);
    // The dashboard read is owned by DockPillarsView: its own cleanup aborts the
    // in-flight flight when it unmounts, so this panel does not duplicate it.
    abortAnalytics();
    // Unmounting mid-pillars must not leave the chain suspended forever.
    if (pillarsOpen()) resumePolling();
    if (contractChart()) resumePolling();
  });

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A native picker (expiry <select>) or the lot input owns Escape while it
      // is focused: the browser closes the picker, not the dock.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (contractChart()) closeContractChart();
      else if (maximized() && !pillarsOpen()) setMaximized(false);
      else if (pillarsOpen()) closePillars();
      else {
        abortAnalytics();
        props.onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Maximize a11y: dialog semantics + scroll lock while maximized, focus capture
  // on the restore button, and focus/overflow restore on exit.
  createEffect(() => {
    const m = maximized();
    if (m && !wasMaximized) {
      // Entering the pillars or a contract chart detaches the button that
      // opened them; capturing it would leave a dead node. Their close
      // handlers own that restore instead.
      const viaOverlay = enteringPillars || enteringContract;
      enteringPillars = false;
      enteringContract = false;
      if (viaOverlay) {
        restoreTarget = null;
      } else {
        const active = document.activeElement as HTMLElement | null;
        restoreTarget = active && document.body.contains(active) ? active : null;
      }
      const root = document.querySelector<HTMLElement>('[data-testid="options-dock"]');
      if (root) root.setAttribute("aria-modal", "true");
      setScrollLock(true);
      const restoreButton = document.querySelector<HTMLElement>('[data-testid="options-maximize"]');
      if (!viaOverlay && restoreButton) restoreButton.focus({ preventScroll: true });
      else root?.focus({ preventScroll: true });
    } else if (!m && wasMaximized) {
      const root = document.querySelector<HTMLElement>('[data-testid="options-dock"]');
      if (root) root.removeAttribute("aria-modal");
      setScrollLock(false);
      restoreTarget?.focus?.({ preventScroll: true });
      restoreTarget = null;
    }
    wasMaximized = m;
  });

  onCleanup(() => {
    if (wasMaximized) {
      const root = document.querySelector<HTMLElement>('[data-testid="options-dock"]');
      if (root) root.removeAttribute("aria-modal");
      setScrollLock(false);
      restoreTarget?.focus?.({ preventScroll: true });
      restoreTarget = null;
    }
  });

  const symbol = () => optionsDockState.symbol ?? "—";
  const chain = () => optionsDockState.chain;
  const spot = () => chain()?.spot ?? optionsDockState.underlying?.spot ?? 0;

  const openContractChart = (strike: number, type: "CE" | "PE", leg: ChainLeg) => {
    if (contractChart()) return;
    restoreMaximizeContract = maximized();
    setContractChart({
      instrumentKey: leg.instrumentKey ?? "",
      symbol: symbol(),
      expiry: optionsDockState.expiry ?? "",
      strike,
      side: type,
      ltp: leg.ltp,
      spot: spot(),
    });
    // Only a real (false → true) transition runs the maximize effect, which is
    // the only consumer of this flag.
    enteringContract = !maximized();
    setMaximized(true);
    // The chain is off screen; a poll would spend the options slice on a table
    // nobody can see.
    suspendPolling();
  };

  const closeContractChart = () => {
    const target = contractChart();
    if (!target) return;
    const restore = restoreMaximizeContract;
    restoreMaximizeContract = false;
    setContractChart(null);
    setMaximized(restore);
    resumePolling();
    // Solid has re-rendered the chain by now, so the originating button is a
    // fresh node: find it by the contract it describes.
    const trigger =
      document.querySelector<HTMLElement>(
        `[data-testid="options-${target.side.toLowerCase()}-${target.strike}-chart"]`,
      ) ?? document.querySelector<HTMLElement>('[data-testid="options-chain-center"]');
    trigger?.focus?.({ preventScroll: true });
  };
  const selectedExpiry = createMemo(() =>
    optionsDockState.expiries.find((entry) => entry.date === optionsDockState.expiry) ?? null,
  );
  const dteYears = createMemo(() => dteYearsOf(optionsDockState.expiry, now()));
  // E1's `market_state` is the authority (it knows holidays and the 15:40
  // derivatives close); the local clock is only the fallback before E1 lands.
  const marketClosed = () => {
    const state = optionsDockState.underlying?.marketState;
    if (state) return state === "closed";
    return !isMarketOpenNow(now());
  };
  const asOfLabel = createMemo(() => {
    const asOf = optionsDockState.asOf;
    if (!asOf) return null;
    const date = new Date(asOf);
    if (Number.isNaN(date.getTime())) return asOf;
    return date.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  });

  // Seconds left in a 429 pause, read off the ticking clock. Floored at 0 so a
  // late tick can never show "retry in -1 s".
  const retrySeconds = createMemo(() => {
    const paused = optionsDockState.paused;
    if (!paused) return 0;
    const retryAt = Number.isFinite(paused.retryAt)
      ? paused.retryAt
      : Date.now() + paused.retryAfterMs;
    const remaining = retryAt - now().getTime();
    return Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining / 1000)) : 0;
  });

  const handlePick = (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => {
    const premium = leg.ltp ?? 0;
    addLeg({ side, type, strike, premium, expiry: optionsDockState.expiry ?? undefined });
  };

  const legs = () => optionsDockState.legs;

  const openPaperPositions = createMemo(() =>
    paperState().positions.filter((position) => position.status === "open"),
  );
  const paperPnl = createMemo(() =>
    openPaperPositions().reduce((total, position) => total + position.totalPnl, 0),
  );

  const stripContext = (): AnalyticsStripContext => ({
    symbol: symbol(),
    expiry: selectedExpiry(),
    spot: spot(),
    atmIv: chain()?.atmIv ?? null,
    marketState: optionsDockState.underlying?.marketState ?? null,
  });
  const stripMaxPain = () =>
    chain()?.levels?.maxPain?.strike ?? optionsAnalyticsState.data?.levels?.maxPain ?? null;

  // One shell for both branches: the payoff tab renders it here, the lazy
  // analytics tabs render the identical strip inside AnalyticsPanel.
  const renderStrip = () => (
    <AnalyticsTabStrip
      value={analyticsTab()}
      onChange={selectAnalyticsTab}
      headline={analyticsHeadline()}
      onRefresh={() => void refreshAnalytics()}
      refreshing={optionsAnalyticsState.refreshing}
      symbol={optionsDockState.symbol}
      context={stripContext()}
      data={optionsAnalyticsState.data}
      maxPain={stripMaxPain()}
      expiryOptions={optionsDockState.expiries}
      selectedExpiry={optionsDockState.expiry}
      onSelectExpiry={setExpiry}
      onOpenPillars={openPillars}
      helpOpen={analyticsHelpOpen()}
      onHelpOpenChange={setAnalyticsHelpOpen}
    />
  );

  /**
   * The analytics band. Legs are only needed by the PAYOFF tab, so a chart tab
   * (and the four pillars behind the strip) must open with zero legs — the
   * no-legs branch renders the same band and falls back to the placeholder
   * inside the PAYOFF tab only.
   */
  const renderBand = () => (
    <Box
      className={maximized() ? "flex min-h-0 flex-1" : "flex shrink-0"}
      style={maximized() ? undefined : { height: bandHeight(analyticsTab()) }}
    >
      <DockSection
        title="PAYOFF"
        testId="options-analytics-band"
        headerTestId="dock-section-analytics"
        header={<></>}
        fill
        padded={false}
      >
        <Show
          when={analyticsTab() === "payoff"}
          fallback={
            <Suspense
              fallback={
                <Box className="flex min-h-0 flex-1 items-center justify-center">
                  <Box
                    component="span"
                    className="font-mono text-[11px] leading-[14px] uppercase text-fin-text-muted"
                  >
                    Loading analytics
                  </Box>
                </Box>
              }
            >
              <AnalyticsPanel
                tab={analyticsTab() as AnalyticsContentTab}
                symbol={symbol()}
                rows={chain()!.rows}
                spot={spot()}
                atmIv={chain()!.atmIv}
                legs={legs()}
                selectedExpiry={optionsDockState.expiry}
                dteYears={dteYears()}
                onHeadline={setAnalyticsHeadline}
                onTabChange={selectAnalyticsTab}
                headline={analyticsHeadline()}
                onRefresh={() => void refreshAnalytics()}
                refreshing={optionsAnalyticsState.refreshing}
                context={stripContext()}
                maxPain={stripMaxPain()}
                expiryOptions={optionsDockState.expiries}
                onSelectExpiry={setExpiry}
                onOpenPillars={openPillars}
                helpOpen={analyticsHelpOpen()}
                onHelpOpenChange={setAnalyticsHelpOpen}
              />
            </Suspense>
          }
        >
          {renderStrip()}
          <PayoffPanel
            legs={legs()}
            spot={spot()}
            iv={chain()!.atmIv}
            dteYears={dteYears()}
            showHeader={false}
          />
        </Show>
      </DockSection>
    </Box>
  );

  // Chart tabs do not need a leg; only the PAYOFF tab has nothing to show
  // without one, so the band appears as soon as a chart tab is chosen.
  const bandVisible = () => legs().length > 0 || analyticsTab() !== "payoff";

  return (
    // The sheet/rail wrappers clip at a fixed height, so the dock is the single
    // scroll owner: a short sheet scrolls instead of clipping LEGS/PAYOFF.
    <Box
      data-testid="options-dock"
      // A maximized dock is a real dialog, not a plain div with aria-modal set
      // imperatively. The focus trap is deliberately deferred: the dock's own
      // controls stay tabbable and Escape/Back are the documented exits.
      role={maximized() ? "dialog" : undefined}
      aria-label={maximized() ? "Options dock" : undefined}
      tabIndex={maximized() ? -1 : undefined}
      className={
        maximized()
          ? "fixed inset-0 z-[1200] flex flex-col overflow-hidden bg-fin-surface"
          : "flex flex-1 min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto bg-fin-surface"
      }
    >
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                           */}
      {/* ---------------------------------------------------------------- */}
      <Box
        className="flex shrink-0 flex-col gap-2 border-b border-fin-border-default px-3 py-2"
        data-testid="options-dock-header"
      >
        <Box className="flex items-center gap-2">
          <Text
            size="sm"
            fw={700}
            className="font-mono tabular-nums truncate"
            data-testid="options-dock-symbol"
          >
            {symbol()}
          </Text>
          <Show
            when={optionsDockState.expiries.length > 0}
            fallback={
              <Show when={optionsDockState.status === "loading"}>
                <Box
                  aria-hidden="true"
                  data-testid="options-dock-header-skeleton"
                  style={{
                    height: "10px",
                    width: "84px",
                    "border-radius": "2px",
                    "background-color": palette.BORDER,
                  }}
                />
              </Show>
            }
          >
            <select
              aria-label="Expiry"
              data-testid="options-expiry-select"
              value={optionsDockState.expiry ?? ""}
              onChange={(event) => setExpiry(event.currentTarget.value)}
              className="h-8 min-w-0 cursor-pointer rounded-fin border border-fin-border-default bg-fin-surface px-2 font-mono text-[11px] leading-[14px] text-fin-text"
            >
              <For each={optionsDockState.expiries}>
                {(entry) => <option value={entry.date}>{expiryLabel(entry, now())}</option>}
              </For>
            </select>
          </Show>

          <Box className="flex flex-1 items-baseline justify-end gap-2">
            <Show when={spot() > 0}>
              <Text
                size="sm"
                fw={700}
                className="font-mono tabular-nums"
                data-testid="options-dock-spot"
              >
                {spot().toLocaleString("en-IN", { maximumFractionDigits: 1 })}
              </Text>
            </Show>
            <Show when={chain()?.spotChangePct != null}>
              <Text
                size="xs"
                fw={600}
                className="font-mono tabular-nums"
                data-testid="options-dock-change"
                style={{ color: spotMoveColor(chain()!.spotChangePct) }}
              >
                {formatPercentage(chain()!.spotChangePct!)}
              </Text>
            </Show>
          </Box>

          <Box className="flex items-center gap-2">
            <Show when={optionsDockState.paused}>
              <Tooltip label={`Rate limited — refreshing in ${retrySeconds()} s`}>
                <Box
                  component="span"
                  className="font-mono text-[11px] leading-[14px] uppercase text-fin-warning"
                  data-testid="options-refresh-paused"
                >
                  Refreshing paused
                </Box>
              </Tooltip>
            </Show>
            <Show when={marketClosed() && !optionsDockState.paused}>
              <Box
                component="span"
                className="font-mono text-[11px] leading-[14px] uppercase text-fin-text-muted"
                data-testid="options-market-closed"
              >
                {asOfLabel() ? `closed · as of ${asOfLabel()}` : "market closed"}
              </Box>
            </Show>
            <Tooltip label="Option paper positions">
              <Box
                component="button"
                type="button"
                aria-label="Open option paper positions"
                data-testid="options-positions-chip"
                onClick={() => setPositionsOpen(true)}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-fin border border-fin-border-default bg-transparent px-2 font-mono text-[11px] leading-[14px] text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary"
              >
                POSITIONS {openPaperPositions().length} · {formatSignedPnl(paperPnl())}
              </Box>
            </Tooltip>
            <Tooltip label="Refresh">
              <Box
                component="button"
                type="button"
                aria-label="Refresh option chain"
                data-testid="options-refresh"
                onClick={() => void refresh()}
                className="inline-flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-primary"
              >
                <IconRefresh size={12} />
              </Box>
            </Tooltip>
            <Tooltip
              label={
                pillarsOpen() || contractChart()
                  ? "Back to chain first"
                  : maximized()
                    ? "Restore"
                    : "Maximize"
              }
            >
              <Box
                component="button"
                type="button"
                aria-label={maximized() ? "Restore options dock" : "Maximize options dock"}
                data-testid="options-maximize"
                // The pillars and the contract chart own the full-screen size;
                // un-maximizing here would shrink the chart. Back is the exit.
                disabled={pillarsOpen() || contractChart() !== null}
                onClick={() => setMaximized((v) => !v)}
                className="inline-flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {maximized() ? <IconArrowsMinimize size={12} /> : <IconArrowsMaximize size={12} />}
              </Box>
            </Tooltip>
            <Tooltip label="Close">
              <Box
                component="button"
                type="button"
                aria-label="Close options dock"
                data-testid="options-close"
                onClick={() => {
                  setPillarsOpen(false);
                  setMaximized(false);
                  close();
                  abortAnalytics();
                  props.onClose?.();
                }}
                className="inline-flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-negative"
              >
                <IconX size={12} />
              </Box>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {/* ---------------------------------------------------------------- */}
      {/* Body                                                             */}
      {/* ---------------------------------------------------------------- */}
      <Show
        when={
          !pillarsOpen() &&
          !contractChart() &&
          optionsDockState.status === "error" &&
          optionsDockState.error
        }
      >
        <EmptyState
          data-testid="options-dock-error"
          kind="failed"
          className="min-h-[160px] flex-1"
          title={
            optionsDockState.error!.kind === "auth"
              ? "Reconnect Upstox in Settings"
              : optionsDockState.error!.message
          }
          description={
            optionsDockState.error!.kind === "auth"
              ? "The options chain needs a live Upstox session."
              : "Retry the chain, or reconnect your broker in Settings."
          }
          action={
            <Button
              size="sm"
              variant="default"
              onClick={() => void refresh()}
              data-testid="options-dock-retry"
            >
              Retry
            </Button>
          }
        />
      </Show>

      <Show when={!pillarsOpen() && !contractChart() && optionsDockState.status === "empty"}>
        <EmptyState
          data-testid="options-dock-empty"
          kind="no-data"
          className="min-h-[160px] flex-1"
          title={`No listed options for ${symbol()}`}
          description="The chart, TradingView and copy actions still work for this symbol."
        />
      </Show>

      <Show
        when={
          !pillarsOpen() &&
          optionsDockState.status !== "error" &&
          optionsDockState.status !== "empty"
        }
      >
        <Show
          when={chain()}
          fallback={
            <Show
              when={optionsDockState.status === "loading"}
              fallback={
                <Box className="flex flex-1 items-center justify-center" data-testid="options-dock-idle">
                  <Text size="xs" c="dimmed">
                    No chain loaded
                  </Text>
                </Box>
              }
            >
              <Box
                className="flex min-h-[160px] flex-1 flex-col items-center justify-center gap-3 p-6"
                data-testid="options-dock-loading"
              >
                <Text size="xs" c="dimmed">
                  Loading {symbol()} chain…
                </Text>
              </Box>
            </Show>
          }
        >
          {/* Hidden, not unmounted, while a contract chart is open: the table
              keeps its scroll offset, so Back lands where the user left. */}
          <Box
            data-testid="options-dock-body"
            className="contents"
            style={contractChart() ? { display: "none" } : undefined}
          >
            <DockSection
              title={
                selectedExpiry()
                  ? `CHAIN · ${symbol()} ${shortDate(selectedExpiry()!.date)}`
                  : `CHAIN · ${symbol()}`
              }
              testId="options-chain-section"
              headerTestId="dock-section-chain"
              className="min-h-[160px]"
              fill
              padded={false}
              separated={false}
              meta={
                <Box className="flex items-center gap-2">
                  <Tooltip label="Center on at-the-money strike">
                    <ActionIcon
                      variant="transparent"
                      data-testid="options-chain-center"
                      aria-label="Center on at-the-money strike"
                      className="text-fin-text-muted hover:text-fin-primary"
                      onClick={() => setChainCenterNonce((n) => n + 1)}
                    >
                      <IconTarget size={12} />
                    </ActionIcon>
                  </Tooltip>
                  <Show when={!isStrikeOrder()}>
                    <Tooltip label="Reset to strike order">
                      <Box
                        component="button"
                        type="button"
                        aria-label="Reset to strike order"
                        data-testid="options-chain-reset-sort"
                        onClick={() => setChainSorting([...DEFAULT_CHAIN_SORTING])}
                        className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-fin border border-fin-border-default bg-transparent px-2 font-mono text-[11px] leading-[14px] text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary"
                      >
                        <IconRotate size={12} />
                        <span className="hidden sm:inline">Strike</span>
                      </Box>
                    </Tooltip>
                  </Show>
                  <Show when={isNarrow()}>
                    <ChainSideToggle value={chainSide()} onChange={setChainSide} />
                  </Show>
                  <Box
                    component="span"
                    className="inline-flex items-baseline gap-2 font-mono tabular-nums text-[11px] leading-[14px] text-fin-text-muted"
                  >
                    <span>{chain()!.rows.length}</span>
                    <span>strikes</span>
                  </Box>
                </Box>
              }
            >
              {/* The strip is the chain's own stat row: outside the header it read
                  as one more captionless band in the column. */}
              <SummaryStrip
                rows={chain()!.rows}
                spot={spot()}
                pcr={chain()!.pcr}
                atmIv={chain()!.atmIv}
                dteDays={selectedExpiry()?.dteDays ?? 0}
                dteYears={dteYears()}
              />
              <Show when={optionsDockState.error && optionsDockState.status !== "error"}>
                <Box
                  data-testid="options-dock-error"
                  className="flex min-h-8 shrink-0 items-center gap-2 overflow-hidden border-l-2 bg-fin-surface-alt px-3 py-2"
                  style={{ "border-left-color": bannerColor(optionsDockState.error!) }}
                >
                  <Box
                    component="span"
                    className="min-w-0 flex-1 truncate font-mono text-[11px] leading-[14px] font-bold"
                    style={{ color: bannerColor(optionsDockState.error!) }}
                  >
                    {bannerMessage(optionsDockState.error!, retrySeconds())}
                  </Box>
                  <Box
                    component="button"
                    type="button"
                    aria-label="Retry option chain refresh"
                    data-testid="options-dock-retry"
                    onClick={() => void refresh()}
                    className="inline-flex min-h-6 shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 font-mono text-[11px] leading-[14px] font-bold hover:underline"
                    style={{ color: bannerColor(optionsDockState.error!) }}
                  >
                    Retry
                  </Box>
                </Box>
              </Show>
              <OptionChainTable
                rows={chain()!.rows}
                spot={spot()}
                side={chainSide()}
                expiry={optionsDockState.expiry}
                centerNonce={chainCenterNonce()}
                loading={optionsDockState.refreshing && chain()!.rows.length === 0}
                onPick={handlePick}
                onChart={openContractChart}
                sorting={chainSorting()}
                onSortingChange={setChainSorting}
              />
            </DockSection>
            <StrategyControl />
            <LegBuilder
              legs={legs()}
              netPremium={netPremium()}
              currentExpiry={optionsDockState.expiry}
            />
            <Show when={legs().length > 0}>
              <WithRouterFallback>
                <PaperOrderBand
                  symbol={symbol()}
                  expiry={optionsDockState.expiry ?? ""}
                  legs={legs()}
                  chainLadder={{
                    spot: spot(),
                    strikes: chain()?.rows.map((row) => row.strike) ?? [],
                  }}
                />
              </WithRouterFallback>
            </Show>
            <Show
              when={bandVisible()}
              fallback={
                // Stripe above the caption so the four pillars open with zero legs;
                // PAYOFF itself stays a placeholder until there is something to price.
                <DockSection title="PAYOFF" testId="options-payoff-placeholder">
                  {renderStrip()}
                  <Box className="flex flex-wrap items-baseline gap-2 text-[11px] leading-4 text-fin-text-muted">
                    <span className="font-mono tabular-nums">
                      {formatDte(selectedExpiry()?.dteDays ?? 0)}
                    </span>
                    <span>add a leg to see the payoff</span>
                  </Box>
                </DockSection>
              }
            >
              {renderBand()}
            </Show>
          </Box>
        </Show>
      </Show>

      {/* The four-pillar analytics, in place of the chain. The dock stays the
          same surface: legs, expiry and symbol are not lost to a route hop. */}
      <Show when={pillarsOpen()}>
        <Suspense
          fallback={
            <Box
              className="flex flex-1 flex-col items-center justify-center gap-2"
              data-testid="dock-pillars-chunk-loading"
            >
              <Text size="xs" c="dimmed">
                Loading pillars…
              </Text>
            </Box>
          }
        >
          <DockPillarsView
            symbol={optionsDockState.symbol ?? ""}
            onBack={closePillars}
            selectedExpiry={optionsDockState.expiry}
            onExpiry={setExpiry}
          />
        </Suspense>
      </Show>

      {/* One contract's chart, in place of the chain. Back is the only exit and
          returns to the same expiry, legs and scroll position. */}
      <Show when={contractChart()}>
        {(target) => (
          <Suspense
            fallback={
              <Box
                className="flex flex-1 flex-col items-center justify-center gap-2"
                data-testid="options-contract-chart-loading"
              >
                <Text size="xs" c="dimmed">
                  Loading chart…
                </Text>
              </Box>
            }
          >
            <Box className="flex min-h-0 flex-1 flex-col" data-testid="options-contract-chart">
              <ContractChartPanel selection={target()} onBack={closeContractChart} />
            </Box>
          </Suspense>
        )}
      </Show>

      <Modal
        opened={positionsOpen()}
        onClose={() => setPositionsOpen(false)}
        title="Option paper positions"
        size="lg"
        data-testid="option-positions-modal"
      >
        <OptionPositionsPanel />
      </Modal>
    </Box>
  );
}
