import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { compositeOver } from "@/utils/contrast";
import { CompactPanel } from "@/components/common/compact";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import type { NiftyStrike } from "@/types/niftyReport";
import {
  OI_CHAIN_HEADER_HEIGHT,
  OI_CHAIN_MAX_HEIGHT,
  OI_CHAIN_METRICS,
  OI_CHAIN_MOBILE_ROW_PX,
  OI_CHAIN_MOBILE_VIEWPORT_MAX,
} from "./reportCells.chainMetrics";
import { ReportPanelTitle } from "./reportCells.decision";

// On a phone the slot is a fixed grid track, so the panel fills it instead of
// hugging five rows: the body then owns a definite height and the table scrolls
// inside it. At 1600 the `flex: 0 0 auto` hug is unchanged.
const OI_CHAIN_PANEL_CLASS = "min-w-0 min-h-0 max-[600px]:flex-1!";
const OI_CHAIN_PANEL_STYLE: JSX.CSSProperties = {
  "background-color": palette.TERM_BG,
  "border-color": palette.TERM_BORDER,
  // `contain: size` made the panel's intrinsic height zero, so the parent's
  // flex:1 stretched a five-row chain across the whole chart row. Layout/paint
  // isolation without size containment lets the panel hug its real rows.
  contain: "layout paint",
  // Containing block for the absolutely positioned scroll cue. No height is
  // added to the window: the cue floats over the chain's last partial row.
  position: "relative",
  // A definite width is mandatory here. With `flex: 0 0 auto` the panel is
  // intrinsically sized, but the TanStackTable inside declares `width: 100%`;
  // Chrome resolves that circular percentage against a ~1,000,000px cap. The
  // panel then overflows its 420px column and every right-aligned cell (strike,
  // signals, ΔOI numbers) lands off-screen — only the first cell's bar shows.
  // `align-self: flex-start` still hugs the rows vertically.
  width: "100%",
  flex: "0 0 auto",
  "align-self": "flex-start",
  // Definite px, never a percentage: the flex parent has no definite height and
  // `100%` collapsed the wrap to a header-only strip in the 1600 capture.
  // Five rows (~177px) still hug their content; a full ~782px chain caps here.
  "max-height": `${OI_CHAIN_MAX_HEIGHT}px`,
};

/**
 * Real ATM/wall row emphasis — no placeholder tint on the other rows.
 * The shared table's cells paint `background-color: inherit`, so a translucent
 * row tint is composited twice (row + cell) and the desk's blue/amber ink drops
 * below 4.5:1. Flatten the tint to one opaque layer over the table surface.
 */
const OI_CHAIN_FOCUS_STYLE: JSX.CSSProperties = {
  "background-color": compositeOver(palette.TERM_FLIP, palette.SURFACE, 0.1),
  "box-shadow": `inset 3px 0 0 ${palette.TERM_FLIP}`,
};

/**
 * TanStackTable paints padding/height/size inline on every cell. An `!important`
 * rule on the cell itself is the only way to keep the chain's own rhythm
 * without forking the shared table (a custom property on an ancestor loses to
 * the table's inline declaration). Font sizes reference the shared `--text-ui-*`
 * tokens, never a private px literal. `overflow-x: auto` is the real scroll cue
 * at 390: the seven-column chain keeps its full width instead of tearing values
 * mid-word to fit the phone. The inner table scroll area carries the vertical
 * overflow once the panel hits its max-height; a thin scrollbar is the cue.
 * At 390 the wrap is capped by its definite parent instead of the 360px cap, so
 * the table viewport (not a clipped panel body) is what scrolls and ATM centring
 * lands on rows the user can actually see.
 */
const OI_CHAIN_WRAP_CLASS = [
  "flex min-w-0 min-h-0 overflow-x-auto overflow-y-auto",
  "max-[600px]:max-h-full!",
  "[&_td]:[padding:4px_8px]!",
  "[&_td]:[height:26px]!",
  "[&_td]:[font-size:var(--text-ui-body)]!",
  "[&_th]:[padding:4px_8px]!",
  "[&_th]:[height:28px]!",
  "[&_th]:[font-size:var(--text-ui-micro)]!",
  "[&_thead_th]:[border-bottom:2px_solid_var(--color-fin-border)]!",
  // Sticky header boundary: the shadow paints a solid band under the header's
  // own border, masking the sub-pixel strip of the row scrolled behind it.
  // It is a paint-only rule, so no row height is stolen and ATM pinning is
  // unaffected.
  "[&_thead_th]:[box-shadow:0_3px_0_var(--color-fin-surface-alt)]!",
  "[&_td]:[text-overflow:clip]!",
  "[&_.paper-tanstack-scroll]:overflow-y-auto",
  "[&_.paper-tanstack-scroll]:[scrollbar-width:thin]",
  // Seven roomy columns are ~712px behind a ~374px phone window. At that
  // breakpoint, size the TanStack host and its scrollport to the table's
  // columns so neither clips or scrolls sideways: the focusable region then
  // owns x-scroll alone (arrow keys move what the finger drags) and PE ΔOI is
  // reachable in full. The 1600 compact chain keeps its full-width table.
  "max-[600px]:[&_.paper-tanstack-container]:[flex:none]!",
  "max-[600px]:[&_.paper-tanstack-container]:[width:max-content]!",
  "max-[600px]:[&_.paper-tanstack-scroll]:[width:max-content]!",
  "max-[600px]:[&_table]:[width:max-content]!",
].join(" ");
const OI_CHAIN_WRAP_STYLE: JSX.CSSProperties = {
  height: "auto",
  // Same definite cap as the panel; `height: auto` keeps the five-row hug and
  // lets the table scroll area own the overflow once the rows exceed the cap.
  "max-height": `${OI_CHAIN_MAX_HEIGHT}px`,
  "overflow-x": "auto",
  "overflow-y": "auto",
};

const OI_CHAIN_TABLE_STYLE: JSX.CSSProperties = { "min-width": 0 };

const OI_CHAIN_EXPAND_CLASS = "min-w-[22px] px-1 leading-none text-ui-micro";

/**
 * The desk window shows only ~6 rows of a ~29-row chain. A thin scrollbar is
 * easy to miss, so an aria-hidden gradient fades the last partial row into the
 * table surface and a separate, readable label names the gesture. Both live in
 * one overlay with no border and no layout height — vertical scrolling is still
 * owned by the chain's own scroll area, and the sticky header is untouched.
 */
/**
 * The phone chain track ends flush with the pinned DESK BAY bar. An overlay
 * anchored at `bottom-0` loses the lower half of both cue pills to that edge,
 * so the phone breakpoint reserves the pill's own height as bottom padding and
 * lifts the pills inside the visible window. Both cues share the one overlay;
 * the opaque pills still mask the clipped partial row behind them.
 */
export const OI_CHAIN_CUE_LANE_PX = 16;
const OI_CHAIN_SCROLL_CUE_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-end px-2 pb-1 pt-3 max-[600px]:pb-[var(--oi-chain-cue-lane)]";
const OI_CHAIN_SCROLL_CUE_STYLE: JSX.CSSProperties = {
  position: "absolute",
  "--oi-chain-cue-lane": `${OI_CHAIN_CUE_LANE_PX}px`,
};
const OI_CHAIN_SCROLL_FADE_STYLE: JSX.CSSProperties = {
  background: `linear-gradient(to top, ${palette.SURFACE}, ${palette.alpha(palette.SURFACE, 0)})`,
};
/** Right-edge wash: clipped columns read as "more to the right", not a bug. */
const OI_CHAIN_H_FADE_STYLE: JSX.CSSProperties = {
  background: `linear-gradient(to right, ${palette.alpha(palette.SURFACE, 0)}, ${palette.SURFACE})`,
};

/**
 * The old single sentence clipped to "SCROLL FO" in the 390px chain and its
 * glyphs printed straight over the last row's ΔOI value. Two responsive runs
 * share one testid: the terse `scroll ↓` is the only one shown on the phone,
 * the full sentence is desk-only. The opaque, width-bounded pill masks the
 * faded partial row behind it instead of mixing ink with a live value, and it
 * stays inside the bottom-of-viewport overlay — never a new layout row.
 */
const OI_CHAIN_SCROLL_PILL_CLASS =
  "relative inline-flex max-w-full items-center overflow-hidden whitespace-nowrap rounded-sm px-2 py-0.5 text-ui-micro font-bold leading-none";
const OI_CHAIN_SCROLL_PILL_STYLE: JSX.CSSProperties = {
  "background-color": palette.TERM_HEADER,
  color: palette.TEXT_MUTED,
};
const OI_CHAIN_SCROLL_SHORT_CLASS = "hidden max-[600px]:inline uppercase";
const OI_CHAIN_SCROLL_LONG_CLASS = "inline max-[600px]:hidden uppercase";

/**
 * The sideways cue is hidden at the base breakpoint and becomes an opaque pill
 * on the phone only. It sits at the left of the bottom overlay so the vertical
 * `scroll ↓` pill keeps the right corner; both disappear at the scroll end.
 */
const OI_CHAIN_H_SCROLL_CUE_CLASS =
  "relative mr-auto hidden max-w-full max-[600px]:inline-flex items-center overflow-hidden whitespace-nowrap rounded-sm px-2 py-0.5 text-ui-micro font-bold leading-none";

const OI_CHAIN_SCROLL_STEP = 80;

/** Arrow keys must scroll the same node that carries focus and `role=region`. */
function onChainRegionKeyDown(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const region = event.currentTarget as HTMLElement;
  region.scrollLeft += event.key === "ArrowRight" ? OI_CHAIN_SCROLL_STEP : -OI_CHAIN_SCROLL_STEP;
  event.preventDefault();
}

/**
 * The ATM strike is the one row a dense chain must open on. The strike cell
 * already stamps `nifty-strike-atm-badge`, so the panel can find and centre it
 * without a second ATM prop or a caller-specific row test id. The target is
 * absolute (not a delta) so re-centring after a selection change is idempotent.
 */
function centreChainAtm(root: HTMLElement | undefined): void {
  if (!root) return;
  root.removeAttribute("data-chain-atm-centered");
  const badge = root.querySelector('[data-testid="nifty-strike-atm-badge"]');
  if (!(badge instanceof HTMLElement)) return;
  const row = badge.closest("tr");
  if (!(row instanceof HTMLElement)) return;

  let scroller: HTMLElement | null = row.parentElement;
  while (scroller && scroller !== root && scroller.scrollHeight <= scroller.clientHeight + 1) {
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return;

  const viewport = scroller.getBoundingClientRect();
  const target = row.getBoundingClientRect();
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const rowTop = target.top - viewport.top + scroller.scrollTop;
  // A phone viewport only holds two rows, so centring would tuck ATM under the
  // sticky header and leave a half row printed beneath it. Pin it directly
  // below the header: ATM plus the row under it are both full, and the sliver
  // below is the vertical scroll cue. The phone decision is width-keyed too —
  // a desk-window chain dropped into a 390px layout has a taller scrollport
  // than the 156px grid track, and height alone would centre it again.
  const isPhone =
    scroller.clientHeight <= OI_CHAIN_MOBILE_VIEWPORT_MAX ||
    (typeof window !== "undefined" && window.innerWidth <= 600);
  const inset = isPhone ? OI_CHAIN_HEADER_HEIGHT : (viewport.height - target.height) / 2;
  scroller.scrollTop = Math.max(0, Math.min(rowTop - inset, max));
  root.setAttribute("data-chain-atm-centered", "1");
}

export interface NiftyOiChainProps {
  strikes: NiftyStrike[];
  columns: TableColumnDef<NiftyStrike>[];
  getRowStyle: (row: NiftyStrike) => JSX.CSSProperties | undefined;
  getRowTestId: (row: NiftyStrike) => string | undefined;
  panelTestId: string;
  tableTestId: string;
  wrapTestId: string;
  wrapRef?: (el: HTMLDivElement | undefined) => void;
  onExpand?: () => void;
}

export function NiftyOiChain(props: NiftyOiChainProps) {
  const focusOf = (row: NiftyStrike): boolean => {
    const strikeColumn = props.columns.find((c) => c.id === "strike") as
      | (TableColumnDef<NiftyStrike> & { chainRowFocus?: (row: NiftyStrike) => boolean })
      | undefined;
    return strikeColumn?.chainRowFocus?.(row) ?? false;
  };
  const rowStyle = (row: NiftyStrike): JSX.CSSProperties => ({
    ...props.getRowStyle(row),
    ...(focusOf(row) ? OI_CHAIN_FOCUS_STYLE : {}),
  });
  const rowAttributes = (row: NiftyStrike) => ({
    "data-chain-focus": focusOf(row) ? "1" : undefined,
  });

  const [hAtEnd, setHAtEnd] = createSignal(false);
  const measureHorizontal = (el: HTMLElement) => {
    const max = el.scrollWidth - el.clientWidth;
    setHAtEnd(max <= 2 || el.scrollLeft >= max - 2);
  };

  let wrapEl: HTMLDivElement | undefined;
  const attachWrap = (el: HTMLDivElement | undefined) => {
    wrapEl = el;
    props.wrapRef?.(el);
  };

  createEffect(() => {
    const strikes = props.strikes;
    const columns = props.columns;
    if (strikes.length === 0 || columns.length === 0) return;
    // TanStack stamps rows on its own schedule. A microtask can run before
    // that; the zero-delay retry runs after layout, so the ATM row is present
    // when the phone viewport is scrolled.
    const centre = () => centreChainAtm(wrapEl);
    queueMicrotask(centre);
    const timer = setTimeout(centre, 0);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <CompactPanel
      flush
      scrollable
      title={
        <span class="report-window-inner-title">
          <ReportPanelTitle>Option-chain OI (±750 ATM)</ReportPanelTitle>
        </span>
      }
      testId={props.panelTestId}
      action={
        <Box className="flex items-center gap-1">
          {/* The SIG badge leading bar means bullish/bearish, but its colour
              had no key. Name both colours in the header the badges sit under. */}
          <span
            data-testid="nifty-chain-signal-key"
            class="inline-flex items-center gap-1 whitespace-nowrap text-ui-micro"
            title="CE/PE SIG colour key — green bar: bullish · red bar: bearish"
          >
            <span
              aria-hidden="true"
              class="inline-block w-[3px] h-[11px] shrink-0 rounded-[1px]"
              style={{ "background-color": palette.POSITIVE }}
            />
            <span>BULL</span>
            <span
              aria-hidden="true"
              class="inline-block w-[3px] h-[11px] shrink-0 rounded-[1px] ml-1"
              style={{ "background-color": palette.NEGATIVE }}
            />
            <span>BEAR</span>
          </span>
          <Text
            data-testid="nifty-chain-scroll-cue"
            aria-hidden="true"
            className="inline-flex max-[600px]:hidden whitespace-nowrap text-ui-micro font-bold"
            style={{ color: palette.TEXT_MUTED }}
          >
            ⇄
          </Text>
          <Show when={props.onExpand}>
            <Button
              data-testid="nifty-oi-expand"
              size="sm"
              variant="subtle"
              aria-label="Expand the option chain"
              title="Expand the option chain"
              onClick={() => props.onExpand?.()}
              className={OI_CHAIN_EXPAND_CLASS}
            >
              ⤢
            </Button>
          </Show>
        </Box>
      }
      className={OI_CHAIN_PANEL_CLASS}
      style={OI_CHAIN_PANEL_STYLE}
    >
      <Box
        ref={attachWrap}
        data-testid={props.wrapTestId}
        data-chain-row-height={OI_CHAIN_METRICS.rowHeight}
        data-chain-value-size={OI_CHAIN_METRICS.valueSize}
        data-chain-variant={props.columns.length <= 5 ? "compact" : "full"}
        data-chain-scroll="1"
        data-chain-h-scroll="1"
        data-chain-v-scroll="1"
        data-chain-sticky-mask="1"
        data-chain-mobile-row={OI_CHAIN_MOBILE_ROW_PX}
        role="region"
        aria-label="Option chain"
        tabIndex={0}
        onKeyDown={onChainRegionKeyDown}
        onScroll={(event: Event & { currentTarget: HTMLDivElement }) =>
          measureHorizontal(event.currentTarget)
        }
        className={OI_CHAIN_WRAP_CLASS}
        style={OI_CHAIN_WRAP_STYLE}
      >
        <TanStackTable<NiftyStrike>
          data={props.strikes}
          columns={props.columns}
          dataTestId={props.tableTestId}
          emptyMessage="No strikes for this expiry"
          fillContainer
          stickyHeader
          style={OI_CHAIN_TABLE_STYLE}
          getRowStyle={rowStyle}
          getRowAttributes={rowAttributes}
          getRowTestId={props.getRowTestId}
        />
      </Box>
      <Show when={!hAtEnd()}>
        <Box
          data-testid="nifty-chain-h-scroll-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 right-0 top-1/2 z-10 hidden w-6 max-[600px]:block"
        >
          <Box
            data-testid="nifty-chain-h-scroll-fade"
            aria-hidden="true"
            className="absolute inset-0"
            style={OI_CHAIN_H_FADE_STYLE}
          />
        </Box>
      </Show>
      <Box
        data-testid="nifty-chain-v-scroll-overlay"
        data-chain-cue-lane={OI_CHAIN_CUE_LANE_PX}
        className={OI_CHAIN_SCROLL_CUE_CLASS}
        style={OI_CHAIN_SCROLL_CUE_STYLE}
      >
        <Box
          data-testid="nifty-chain-v-scroll-fade"
          aria-hidden="true"
          className="absolute inset-0"
          style={OI_CHAIN_SCROLL_FADE_STYLE}
        />
        <Show when={!hAtEnd()}>
          <Text
            data-testid="nifty-chain-h-scroll-cue"
            className={OI_CHAIN_H_SCROLL_CUE_CLASS}
            style={OI_CHAIN_SCROLL_PILL_STYLE}
          >
            SCROLL →
          </Text>
        </Show>
        <Text
          data-testid="nifty-chain-v-scroll-cue"
          className={OI_CHAIN_SCROLL_PILL_CLASS}
          style={OI_CHAIN_SCROLL_PILL_STYLE}
        >
          <span data-chain-v-cue-copy="short" className={OI_CHAIN_SCROLL_SHORT_CLASS}>
            scroll ↓
          </span>
          <span data-chain-v-cue-copy="full" className={OI_CHAIN_SCROLL_LONG_CLASS}>
            Scroll for more strikes ↓
          </span>
        </Text>
      </Box>
    </CompactPanel>
  );
}
