import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { usePolling } from "@/hooks/usePolling";
import { Box, Text, Skeleton, typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { useSymbolDock } from "../common/symbolDockContext";
import { subscribeToHolidays, isMarketOpenNow, getHolidayState } from "../../state/holidays";
import { tickerLabelForFeedSymbol } from "@/config/tvSymbols";

// Inlined from hooks/useMarketTickerEnabled (still on React); same v2 storage
// key and on-by-default behaviour so existing profiles keep their setting.
const TICKER_ENABLED_KEY = "alphashri_show_market_ticker_v2";

function readTickerEnabled(): boolean {
  try {
    const stored = localStorage.getItem(TICKER_ENABLED_KEY);
    return stored ? (JSON.parse(stored) as boolean) : true;
  } catch {
    return true;
  }
}

export interface MarketTickerItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  is_positive: boolean;
}

export interface MarketTickerData {
  tickers: Record<string, MarketTickerItem>;
  last_updated: string | null;
  loading: boolean;
  error: string | null;
}

import { API_ENDPOINTS } from "../../api/config";

const MARKET_TICKER_API = API_ENDPOINTS.MARKET_TICKER;
const POLL_INTERVAL_MS = 300000; // 5 minutes
/** Local re-check so the label flips at 09:15 / 15:30 without a network poll. */
const MARKET_STATUS_RECHECK_MS = 60000;
/** A closure away from a holiday still has a reason: the session boundaries. */
const SESSION_CLOSED_DETAIL = "Closed at 15:30 IST · Opens 09:15 IST";

const PRIORITY_ORDER = ["^NSEI", "^NSEBANK", "GC=F", "SI=F", "CL=F", "USDINR=X"];

/**
 * Indian indices in the tape map to the chart ids the app-wide dock knows.
 * Every other row is an external quote (commodity / forex) with no app
 * instrument behind it, so it stays a plain, non-interactive tape cell.
 */
const CHART_INDEX_IDS: Record<string, string> = {
  "^NSEI": "NIFTY",
  "^NSEBANK": "BANKNIFTY",
};

/** One label source: the shared feed descriptor canonicalises feed keys. */
function getTickerLabel(symbol: string): string {
  return tickerLabelForFeedSymbol(symbol);
}

function sortTickersByPriority(tickers: Record<string, MarketTickerItem>): string[] {
  return Object.keys(tickers).sort((a, b) => {
    const aPriority = PRIORITY_ORDER.indexOf(a);
    const bPriority = PRIORITY_ORDER.indexOf(b);
    return aPriority - bPriority;
  });
}

function formatLastUpdated(lastUpdated: string | null): string {
  return lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "--";
}

const TICKER_HEIGHT = "40px";
const CUE_ROW_HEIGHT = "16px";
/** The drawer is a fixed overlay over three opaque page bands at 390: the
 *  toolbar (y60–80), the pulse bar (y88–136) and the catalyst header
 *  (y150–165). Reserving 104px puts the opaque tape band at y168.39 — below
 *  the catalyst header, so no page text can interleave with the ticker rows. */
const DRAWER_TICKER_SPACER_HEIGHT = "104px";

/** The tape only ever lives in the 148px desktop rail / 168px mobile drawer.
 *  Stacking label / price / change in three rows makes tile width the widest
 *  *single* field (~65px at 12px) instead of label+price (~136px). Two tiles
 *  then fit the 144px rail scroller, so BANKNIFTY is fully on screen at first
 *  paint instead of showing a cut "BA" at the rail boundary. The signed
 *  absolute + percent change stays in the tooltip (see `title` below). */
const TICKER_TILE_WIDTH = 68;
const TICKER_GRID = {
  display: "grid",
  "grid-template-columns": "max-content",
  "grid-template-rows": "auto auto auto",
  "align-items": "center",
  "column-gap": "0px",
  "row-gap": "0px",
  "width": `${TICKER_TILE_WIDTH}px`,
  "flex-shrink": "0",
  "min-width": `${TICKER_TILE_WIDTH}px`,
} as const;

/** Fallback scroll step when a browser has not laid out the first tile yet. */
const TILE_FALLBACK_WIDTH = TICKER_TILE_WIDTH;

function createErrorState(error: unknown): MarketTickerData {
  return {
    tickers: {},
    last_updated: new Date().toISOString(),
    loading: false,
    error: error instanceof Error ? error.message : "Failed to fetch market data",
  };
}

interface TickerItemProps {
  symbol: string;
  item: MarketTickerItem;
}

function TickerItem(props: TickerItemProps) {
  const dock = useSymbolDock();
  const label = () => getTickerLabel(props.symbol);
  const price = () => Number(props.item.price ?? 0);
  const change = () => Number(props.item.change ?? 0);
  const changePercent = () => Number(props.item.change_percent ?? 0);
  const isPositive = () => change() >= 0;
  const tone = () => (isPositive() ? palette.POSITIVE : palette.NEGATIVE);
  const testId = () => props.symbol.replace(/[\^=]/g, "").toLowerCase();
  const chartId = () => CHART_INDEX_IDS[props.symbol];
  const isIndex = () => chartId() != null;

  // The provider owns the desktop/narrow split: `open` pins the desktop dock
  // and navigates to the chart route below 1200px or for a US market.
  const activate = () => {
    const id = chartId();
    if (id) dock.open(id);
  };

  return (
    <Box
      component={isIndex() ? "button" : "div"}
      type={isIndex() ? "button" : undefined}
      onClick={isIndex() ? activate : undefined}
      onKeyDown={
        isIndex()
          ? (event: KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate();
              }
            }
          : undefined
      }
      style={{ ...TICKER_GRID, border: "none", background: "transparent", padding: 0, color: "inherit", "text-align": "left", cursor: isIndex() ? "pointer" : "default" }}
      className={`market-ticker-item ${isIndex() ? "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-fin-primary)]" : ""}`}
      data-testid={`ticker-${testId()}`}
    >
      <Text
        size="sm"
        fw={600}
        c="dimmed"
        style={{ "font-size": `${typeSize("micro")}px`, "line-height": "1.1", "white-space": "nowrap", "grid-row": "1", "grid-column": "1" }}
      >
        {label()}
      </Text>
      <Text
        size="sm"
        fw={700}
        data-testid={`ticker-price-${testId()}`}
        style={{
          "font-size": `${typeSize("micro")}px`,
          "line-height": "1.1",
          "font-family": palette.MONO,
          "font-variant-numeric": "tabular-nums",
          "text-align": "right",
          "white-space": "nowrap",
          "grid-row": "2",
          "grid-column": "1",
        }}
      >
        {price().toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </Text>
      {/* Compact signed percent on its own row: the full signed absolute +
          percent stays in the tooltip, so the tile only needs ~45px for the
          change and the rail fits two complete index tiles side by side. */}
      <Box
        component="span"
        data-testid={`ticker-change-${testId()}`}
        title={`${change() >= 0 ? "+" : ""}${change().toFixed(2)} (${changePercent().toFixed(2)}%)`}
        className="flex items-center justify-end gap-[2px] whitespace-nowrap font-mono"
        style={{
          color: tone(),
          "font-variant-numeric": "tabular-nums",
          "grid-row": "3",
          "grid-column": "1",
        }}
      >
        <Box component="span" aria-hidden className="text-ui-micro leading-none">
          {isPositive() ? "▲" : "▼"}
        </Box>
        <Text
          size="sm"
          span
          fw={700}
          style={{
            "font-size": `${typeSize("micro")}px`,
            "line-height": "1.1",
            color: tone(),
            "font-family": palette.MONO,
            "font-variant-numeric": "tabular-nums",
            "white-space": "nowrap",
          }}
        >
          {isPositive() ? "+" : ""}
          {changePercent().toFixed(2)}%
        </Text>
      </Box>
    </Box>
  );
}

interface TickerContainerProps {
  children?: JSX.Element;
  title?: string;
  itemCount: number;
}

function TickerContainer(props: TickerContainerProps) {
  const [overflows, setOverflows] = createSignal(false);
  let scroller: HTMLDivElement | undefined;

  // The frame clips, the tape scrolls: one scroll owner, no sibling overlap.
  const measure = () => {
    if (!scroller) return;
    // A hidden drawer has no laid-out width. Keep the item-count assumption
    // until a resize/ResizeObserver tick can report real geometry.
    if (!scroller.clientWidth) return;
    setOverflows(scroller.scrollWidth > scroller.clientWidth + 1);
  };

  createEffect(on(() => props.itemCount, (count) => {
    // The mobile drawer mounts hidden, so its first open fires no resize.
    // Assume a cue until measured rather than showing an unreachable tile.
    if (count > 1) setOverflows(true);
    queueMicrotask(measure);
  }));

  onMount(() => {
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (observer && scroller) observer.observe(scroller);
    window.addEventListener("resize", measure);
    onCleanup(() => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    });
  });

  const scrollNext = () => {
    const tile = scroller?.querySelector<HTMLElement>(".market-ticker-item");
    scroller?.scrollBy({
      left: tile?.offsetWidth || TILE_FALLBACK_WIDTH,
      behavior: "smooth",
    });
  };

  return (
    <Box
      data-testid="market-ticker-frame"
      className="market-ticker-frame flex flex-col w-full min-w-0"
      style={{
        display: "flex",
        "flex-direction": "column",
        width: "100%",
        "min-width": "0px",
        "box-sizing": "border-box",
        "flex-shrink": "0",
        overflow: "hidden",
        // The drawer is a fixed overlay over the Home page. An opaque tape
        // band is the second half of the spacer: nothing behind it can bleed
        // through the reserved rows while the drawer is open.
        "background-color": palette.BG,
      }}
    >
      <Box
        ref={(el: HTMLDivElement) => { scroller = el; }}
        data-testid="market-ticker"
        id="market-ticker"
        className="market-ticker"
        title={props.title}
        role="region"
        aria-label="Market ticker"
        tabIndex={0}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "4px",
          width: "100%",
          height: TICKER_HEIGHT,
          "overflow-x": "auto",
          "overflow-y": "hidden",
          "flex-wrap": "nowrap",
          "min-width": "0px",
          "box-sizing": "border-box",
          "scrollbar-width": "none",
          "padding-left": "2px",
          "padding-right": "2px",
        }}
      >
        {props.children}
      </Box>
      <Show when={overflows()}>
        <Box
          className="flex items-center justify-end w-full min-w-0"
          style={{ height: CUE_ROW_HEIGHT, "flex-shrink": "0", "box-sizing": "border-box" }}
        >
          <button
            type="button"
            data-testid="market-ticker-scroll-cue"
            aria-label="Scroll market ticker"
            title="Scroll market ticker"
            onClick={scrollNext}
            className="flex items-center justify-center rounded-fin border border-fin-border text-ui-micro leading-none"
            style={{
              width: "16px",
              height: CUE_ROW_HEIGHT,
              "flex-shrink": "0",
              "background-color": palette.SURFACE_ALT,
              color: palette.TEXT_MUTED,
            }}
          >
            <Box component="span" aria-hidden>
              ›
            </Box>
          </button>
        </Box>
      </Show>
    </Box>
  );
}

function TickerLoadingState() {
  return (
    <Box
      data-testid="market-ticker"
      id="market-ticker"
      className="market-ticker market-ticker-loading"
      px="sm"
      style={{
        display: "flex",
        "align-items": "center",
        gap: "6px",
        height: TICKER_HEIGHT,
        overflow: "hidden",
        width: "100%",
        "min-width": "0px",
        "box-sizing": "border-box",
      }}
    >
      <For each={[1, 2, 3, 4, 5, 6]}>{() => <Skeleton w={88} h={14} visible />}</For>
    </Box>
  );
}

function TickerErrorState() {
  return (
    <Box
      data-testid="market-ticker"
      id="market-ticker"
      className="market-ticker market-ticker-error"
      px="sm"
      style={{
        display: "flex",
        "align-items": "center",
        height: TICKER_HEIGHT,
        width: "100%",
        "min-width": "0px",
        "box-sizing": "border-box",
        overflow: "hidden",
      }}
    >
      <Text size="sm" c="dimmed" style={{ "font-size": `${typeSize("micro")}px`, "line-height": "1.2" }}>
        Market data unavailable
      </Text>
    </Box>
  );
}

function TickerStatus(props: { label: string; detail?: string | null }) {
  return (
    <Box
      data-testid="market-ticker-status"
      className="flex items-start gap-0.75 min-w-0 overflow-hidden"
      style={{ "padding-left": "4px", "padding-right": "4px" }}
    >
      <Box
        aria-hidden
        className="size-6 rounded-full flex-shrink-0"
        style={{ "background-color": palette.TEXT_MUTED }}
      />
      <Text size="sm" fw={600} c="dimmed" style={{ "font-size": `${typeSize("micro")}px`, "line-height": "1.2" }}>{props.label}</Text>
      <Show when={props.detail}>
        <Text
          size="sm"
          c="dimmed"
          title={`· ${props.detail}`}
          style={{ "font-size": `${typeSize("micro")}px`, "line-height": "1.2" }}
          className="opacity-75 min-w-0 break-words line-clamp-2"
        >
          · {props.detail}
        </Text>
      </Show>
    </Box>
  );
}

function findTodayHoliday() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return getHolidayState().holidays.find((h) => h.date === today) ?? null;
}

/**
 * Single source of truth for "is the exchange open right now?" — the sidebar
 * status dot and the tape must never disagree. `isMarketClosedToday()` only
 * knows about holidays; the session clock lives in `isMarketOpenNow()`.
 */
function useMarketState() {
  const version = useStoreSubscription(subscribeToHolidays);
  const [clockTick, setClockTick] = createSignal(0);
  createEffect(() => {
    const id = window.setInterval(() => setClockTick((n) => n + 1), MARKET_STATUS_RECHECK_MS);
    onCleanup(() => window.clearInterval(id));
  });
  const closed = createMemo(() => {
    version();
    clockTick();
    return !isMarketOpenNow();
  });
  const detail = createMemo(() => {
    if (!closed()) return null;
    return findTodayHoliday()?.description ?? SESSION_CLOSED_DETAIL;
  });
  return { closed, detail };
}

/**
 * Standalone market-state indicator for the sidebar. The old top app bar was
 * the only place that said whether the exchange was open; removing that bar
 * must not remove the information, so the dot + label lives next to the brand.
 */
export function MarketStatus(props: { compact?: boolean }) {
  const compact = () => props.compact ?? false;
  const { closed, detail } = useMarketState();
  const label = () => (closed() ? "Market closed" : "Market live");
  const title = () => (detail() ? `${label()} · ${detail()}` : label());

  return (
    <Box
      data-testid="app-market-status"
      data-state={closed() ? "closed" : "live"}
      title={title()}
      className="flex flex-col min-w-0 w-full"
      style={{
        "align-items": compact() ? "center" : "stretch",
        "padding-left": compact() ? 0 : "2px",
        "padding-right": compact() ? 0 : "2px",
      }}
    >
      <Box
        data-testid="app-market-status-headline"
        className="flex items-center min-w-0"
        style={{ gap: compact() ? 0 : "6px" }}
      >
        <Box
          aria-hidden
          data-testid="app-market-status-dot"
          style={{
            width: "6px",
            height: "6px",
            "border-radius": "50%",
            "flex-shrink": "0",
            "background-color": closed() ? palette.TEXT_MUTED : palette.POSITIVE,
          }}
        />
        <Show when={!compact()}>
          <Text size="sm" fw={600} c="dimmed" style={{ "font-size": `${typeSize("micro")}px`, "line-height": "1.2", "white-space": "nowrap" }}>
            {label()}
          </Text>
        </Show>
      </Box>
      {/* The detail sits on its own full-width row: beside the nowrap label it
          only got ~40px of the 148px rail and broke words mid-token. At full
          width it wraps at whitespace and the title still carries the reason. */}
      <Show when={!compact() && detail()}>
        <Text
          data-testid="app-market-status-detail"
          size="sm"
          c="dimmed"
          title={`· ${detail()}`}
          style={{ "font-size": `${typeSize("micro")}px`, "line-height": "1.2", "margin-top": "2px" }}
          className="w-full min-w-0 break-words line-clamp-2"
        >
          · {detail()}
        </Text>
      </Show>
    </Box>
  );
}

interface MarketTickerProps {
  /**
   * `full` (default) keeps the legacy behaviour: tape when live, status text
   * when closed. `tape` renders the tape only — the sidebar owns the status,
   * so the page must not reserve a strip for it outside market hours.
   */
  variant?: "full" | "tape";
  /** Inside the fixed mobile drawer: reserve a row above the tape so it never
   *  shares a vertical band with the page toolbar behind the drawer. */
  mobile?: boolean;
}

export function MarketTicker(props: MarketTickerProps) {
  const variant = () => props.variant ?? "full";
  const [enabled] = createSignal(readTickerEnabled());
  const [data, setData] = createSignal<MarketTickerData | null>(null);
  const { closed, detail } = useMarketState();
  // Ordering is derived from the fetched payload only: tooltip/hover renders
  // must not re-sort the tape.
  const sortedSymbols = createMemo(() => {
    const t = data()?.tickers;
    return t ? sortTickersByPriority(t) : [];
  });

  const fetchTicker = async () => {
    if (!isMarketOpenNow()) return;
    try {
      const response = await fetch(MARKET_TICKER_API, { priority: "low" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const tickerData = await response.json();
      setData(tickerData);
    } catch (error) {
      setData(createErrorState(error));
    }
  };

  usePolling(fetchTicker, POLL_INTERVAL_MS, {
    enabled: enabled() && !closed(),
    immediate: true,
    skipIfRunning: false,
  });

  return (
    <Show when={enabled()}>
      {/* A closed exchange has no tape to poll: state the reason instead of
          leaving skeletons (or a blank flex row) sitting in the header. */}
      <Show
        when={!closed()}
        fallback={
          <Show when={variant() !== "tape"}>
            <TickerStatus label="Market closed" detail={detail()} />
          </Show>
        }
      >
        <Show
          when={data()}
          fallback={<TickerLoadingState />}
        >
          {(d) => (
            <Show
              when={!d().loading && !d().error}
              fallback={
                <Show when={d().error} fallback={<TickerLoadingState />}>
                  <TickerErrorState />
                </Show>
              }
            >
              <Show when={props.mobile}>
                <Box
                  data-testid="market-ticker-top-spacer"
                  aria-hidden="true"
                  className="w-full flex-shrink-0"
                  style={{ height: DRAWER_TICKER_SPACER_HEIGHT, "min-width": "0px" }}
                />
              </Show>
              <TickerContainer
                title={`Updated: ${formatLastUpdated(d().last_updated)}`}
                itemCount={sortedSymbols().length}
              >
                <For each={sortedSymbols()}>{(symbol) => (
                  <TickerItem symbol={symbol} item={d().tickers[symbol]} />
                )}</For>
              </TickerContainer>
            </Show>
          )}
        </Show>
      </Show>
    </Show>
  );
}
