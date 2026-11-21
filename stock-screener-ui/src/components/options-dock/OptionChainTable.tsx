import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from "solid-js";
import { Box, useMediaQuery } from "@/ui";
import { TanStackTable, type SortEntry } from "@/components/common/TanStackTable";
import type { ChainLeg, ChainRow, OptionChainLevels } from "@/api/optionsDock";
import { optionsDockState } from "../../state/optionsDock";
import { buildStrikeBadges, chainColumns } from "./chain.columns";
import { highlightChainLevels, railShadow } from "./chainHighlight";

/** Natural strike-ladder order: the default and the target of the reset control. */
export const DEFAULT_CHAIN_SORTING: SortEntry[] = [{ id: "strike", desc: false }];

/** Below Tailwind's `sm` the chain drops to a one-sided 5-column layout. */
export const CHAIN_NARROW_QUERY = "(max-width: 639px)";

/** 5 columns × their declared sizes (54+38+34+64+72) — fits a 390px sheet. */
const NARROW_MIN_TABLE_WIDTH = 262;

/** TanStackTable's `dense` rows are `--tbl-row-h: 18px` (the sticky header excluded). */
const CHAIN_ROW_HEIGHT = 18;

/** Hard cap for a programmatic scroll whose browser never emits scrollend. */
export const CHAIN_SCROLL_SETTLE_MS = 450;

/** Without scrollend, release once frames have been quiet this long. */
const CHAIN_SCROLL_QUIET_MS = 200;

/** A single scroll step larger than this is a manual gesture, not an easing frame. */
const CHAIN_MANUAL_DELTA_PX = 100;

/** How close to the intended centre still counts as centred (~1.5 rows). */
const CHAIN_CENTER_TOLERANCE_PX = 28;

/** Modern browsers fire scrollend when a (smooth) scroll actually finishes. */
const SCROLLEND_SUPPORTED = typeof window !== "undefined" && "onscrollend" in window;

/**
 * Scroll-top that centres row `index` in a viewport `clientHeight` tall. The
 * ½-row term aligns the row's midpoint with the viewport midpoint; results
 * before the first row clamp to 0 (a browser also clamps the scroll maximum,
 * which is all the last rows need).
 */
export function centerScrollTop(index: number, rowHeight: number, clientHeight: number): number {
  if (!Number.isFinite(index) || index < 0 || !Number.isFinite(rowHeight) || rowHeight <= 0) {
    return 0;
  }
  const viewport = Number.isFinite(clientHeight) && clientHeight > 0 ? clientHeight : 0;
  const top = index * rowHeight + rowHeight / 2 - viewport / 2;
  return top > 0 ? top : 0;
}

// Theme-aware tint: mixing the primary into the *current* surface keeps the ATM
// row legible in both schemes (an inline palette rgba() sat on a dark literal
// and measured 1.11:1 in light mode). The expression lives in a custom property
// because a bare color-mix() in `background-color` is silently dropped by
// DOM style shims; browsers resolve the var() on paint.
const ATM_BG_STYLE = {
  "--atm-tint": "color-mix(in srgb, var(--color-fin-primary) 8%, var(--color-fin-surface))",
  "background-color": "var(--atm-tint)",
} as JSX.CSSProperties;

/**
 * Row style for a strike: the ATM amber fill always wins, so a level tint is
 * only painted on a non-ATM row. The level rails are independent of that — an
 * ATM row can still carry a wall rail — and never touch height or padding.
 */
function strikeRowStyle(strike: number, atm: number | null, highlight: ReturnType<typeof highlightChainLevels>): JSX.CSSProperties {
  const style: JSX.CSSProperties = {};
  if (strike === atm) {
    Object.assign(style, ATM_BG_STYLE);
  } else if (highlight.tint) {
    style["--level-tint"] = highlight.tint;
    style["background-color"] = "var(--level-tint)";
  }
  const shadow = railShadow(highlight.rails);
  if (shadow) style["box-shadow"] = shadow;
  return style;
}

/**
 * The dock's chain table. One shared `TanStackTable`, 60-row window, no bespoke
 * renderer: the CE/PE halves are just columns with explicit `meta.align`.
 *
 * Cells read their row's plain data (`row.original.ce.ltp`); nothing subscribes
 * per row, which is what keeps a 10 s frame patch cheap.
 */
export function OptionChainTable(props: {
  rows: ChainRow[];
  spot: number;
  loading?: boolean;
  /** Selected side for the narrow layout; ignored at ≥640px. */
  side?: "CE" | "PE";
  onPick?: (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => void;
  /** Opens the per-contract chart; keeps the LTP button a pure buy/sell pick. */
  onChart?: (strike: number, type: "CE" | "PE", leg: ChainLeg) => void;
  /** Controlled sorting. When omitted the table owns it, seeded to strike asc. */
  sorting?: SortEntry[];
  onSortingChange?: (next: SortEntry[]) => void;
  /** Expiry date — a roll swaps the ladder and earns a fresh centre. */
  expiry?: string | null;
  /** Bump to force a re-centre (the chain header's Center button). */
  centerNonce?: number;
  /** Strike levels; falls back to the chain frame in the dock store. */
  levels?: OptionChainLevels | null;
}) {
  const narrow = useMediaQuery(CHAIN_NARROW_QUERY);

  const levels = () => (props.levels !== undefined ? props.levels : (optionsDockState.chain?.levels ?? null));
  // One map per levels change — cells only look up their strike.
  const badgeMap = createMemo(() => buildStrikeBadges(levels()));

  const atmStrike = createMemo(() => {
    const spot = props.spot;
    if (!(spot > 0) || props.rows.length === 0) return null;
    let best = props.rows[0].strike;
    let bestDistance = Math.abs(best - spot);
    for (const row of props.rows) {
      const distance = Math.abs(row.strike - spot);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = row.strike;
      }
    }
    return best;
  });

  const maxOi = createMemo(() => {
    let max = 0;
    for (const row of props.rows) {
      if (row.ce.oi > max) max = row.ce.oi;
      if (row.pe.oi > max) max = row.pe.oi;
    }
    return max;
  });

  // The scroll element belongs to TanStackTable, so reach it through our host.
  let host: HTMLDivElement | undefined;
  const scrollEl = () => host?.querySelector<HTMLElement>(".paper-tanstack-scroll") ?? null;
  const [following, setFollowing] = createSignal(true);
  // A centre is a real smooth scroll. The guard must stay up until that scroll
  // actually ends: a quiet-timer release can fire during a load-induced pause
  // and let the easing's trailing frames look like a manual scroll, flipping
  // following off. Native `scrollend` is the accurate "it stopped" signal; the
  // hard cap covers browsers (and mocks) that never emit it.
  let programmaticScroll = false;
  let programmaticTarget = 0;
  let pendingManual = false;
  let lastScrollTop = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const clearSettleTimer = () => {
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = undefined;
  };

  const finishProgrammaticScroll = () => {
    if (!programmaticScroll) return;
    clearSettleTimer();
    const el = scrollEl();
    const drifted = !!el && Math.abs(el.scrollTop - programmaticTarget) > CHAIN_CENTER_TOLERANCE_PX;
    programmaticScroll = false;
    // A manual grab seen mid-centre, or ending away from the target, means the
    // user took over — drop follow now that the guard has fully released.
    if (pendingManual || drifted) setFollowing(false);
    pendingManual = false;
  };

  const armSettleTimer = (ms: number) => {
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = setTimeout(finishProgrammaticScroll, ms);
  };

  // Only the strike *ladder* (not the 10 s leg patches) is structural. Pair it
  // with the explicit expiry/side/Center signals so a spot tick cannot re-centre
  // a user who scrolled away.
  const strikeKey = createMemo(() => props.rows.map((row) => row.strike).join("|"));
  const centerKey = createMemo(
    () =>
      `${strikeKey()}|${props.expiry ?? ""}|${props.side ?? ""}|${props.centerNonce ?? 0}`,
  );

  const atmIndex = () => {
    const atm = atmStrike();
    if (atm == null) return -1;
    return props.rows.findIndex((row) => row.strike === atm);
  };

  const scrollToIndex = (el: HTMLElement, index: number) => {
    const top = centerScrollTop(index, CHAIN_ROW_HEIGHT, el.clientHeight);
    programmaticScroll = true;
    programmaticTarget = top;
    pendingManual = false;
    lastScrollTop = el.scrollTop;
    // A mocked or instant scroll emits no scrollend, so keep the hard cap.
    armSettleTimer(CHAIN_SCROLL_SETTLE_MS);
    // scrollIntoView is deliberately avoided: it also scrolls the page/dock.
    if (typeof el.scrollTo === "function") el.scrollTo({ top, behavior: "smooth" });
    else el.scrollTop = top;
  };

  const recenter = () => {
    const el = scrollEl();
    if (!el) return;
    const index = atmIndex();
    if (index < 0) return;
    setFollowing(true);
    scrollToIndex(el, index);
  };

  const followRecenter = () => {
    if (!untrack(following)) return;
    if (programmaticScroll) return;
    const el = scrollEl();
    if (!el) return;
    const index = atmIndex();
    if (index < 0) return;
    const rowTop = index * CHAIN_ROW_HEIGHT;
    // Only move when the ATM row has actually left the visible band — a small
    // tick inside the window must not yank the user's scroll position.
    if (rowTop >= el.scrollTop && rowTop + CHAIN_ROW_HEIGHT <= el.scrollTop + el.clientHeight) {
      return;
    }
    scrollToIndex(el, index);
  };

  createEffect(() => {
    centerKey();
    if (untrack(() => props.rows.length === 0)) return;
    untrack(recenter);
  });

  createEffect(() => {
    const spot = props.spot;
    if (!Number.isFinite(spot)) return;
    untrack(followRecenter);
  });

  const onScroll = () => {
    const el = scrollEl();
    if (!el) return;
    const current = el.scrollTop;
    const delta = Math.abs(current - lastScrollTop);
    lastScrollTop = current;
    if (programmaticScroll) {
      // Only a large step that moves *away* from the centre target is a manual
      // grab. Easing frames approach the target, so they never trip this even
      // when load drops frames and makes one easing step unusually large.
      const away = Math.abs(current - programmaticTarget) > CHAIN_CENTER_TOLERANCE_PX;
      if (delta > CHAIN_MANUAL_DELTA_PX && away) pendingManual = true;
      // Without scrollend, keep pushing the quiet release out while frames land.
      if (!SCROLLEND_SUPPORTED) armSettleTimer(CHAIN_SCROLL_QUIET_MS);
      return;
    }
    setFollowing(false);
  };

  const onScrollEnd = () => {
    if (programmaticScroll) finishProgrammaticScroll();
  };

  onMount(() => {
    const el = scrollEl();
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    if (SCROLLEND_SUPPORTED) el.addEventListener("scrollend", onScrollEnd);
    onCleanup(() => {
      el.removeEventListener("scroll", onScroll);
      if (SCROLLEND_SUPPORTED) el.removeEventListener("scrollend", onScrollEnd);
      clearSettleTimer();
    });
  });

  const columns = createMemo(() =>
    chainColumns({
      maxOi,
      atmStrike,
      // Gated on `narrow` so a side passed while wide can never shrink the
      // nine-column desktop layout.
      side: narrow() ? (props.side ?? "CE") : undefined,
      narrow: narrow(),
      badgeFor: (strike) => badgeMap().get(strike),
      onPick: (strike, type, leg, side) => props.onPick?.(strike, type, leg, side),
      onChart: props.onChart
        ? (strike, type, leg) => props.onChart?.(strike, type, leg)
        : undefined,
    }),
  );

  return (
    <Box
      className="flex min-h-0 flex-1 flex-col"
      data-testid="options-chain-table"
      data-following={following() ? "true" : "false"}
      ref={(el: HTMLDivElement) => (host = el)}
    >
      <TanStackTable<ChainRow>
        data={props.rows}
        columns={columns()}
        rowWindowSize={60}
        dense
        fillContainer
        bare
        enableSorting
        stickyHeader
        minTableWidth={narrow() ? NARROW_MIN_TABLE_WIDTH : 452}
        dataTestId="options-chain"
        ariaLabel="Option chain"
        loading={props.loading}
        loadingMessage="Loading chain…"
        emptyMessage="No strikes listed for this expiry"
        getRowTestId={(row) => `options-chain-row-${row.strike}`}
        getRowStyle={(row) => strikeRowStyle(row.strike, atmStrike(), highlightChainLevels(levels(), row.strike))}
        getRowAttributes={(row) => {
          const highlight = highlightChainLevels(levels(), row.strike);
          return {
            "data-atm": row.strike === atmStrike() ? "true" : undefined,
            "data-level": highlight.keys.length ? highlight.keys.join(" ") : undefined,
          };
        }}
        sorting={props.sorting}
        onSortingChange={props.onSortingChange}
        initialState={{ sorting: DEFAULT_CHAIN_SORTING }}
      />
      <Show when={props.rows.length === 0 && !props.loading}>
        <Box className="sr-only" data-testid="options-chain-empty">
          No strikes listed for this expiry
        </Box>
      </Show>
    </Box>
  );
}
