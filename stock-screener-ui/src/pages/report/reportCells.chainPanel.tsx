import { createEffect, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { hexToRgba } from "@/utils/color";
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

/** Real ATM/wall row emphasis — no placeholder tint on the other rows. */
const OI_CHAIN_FOCUS_STYLE: JSX.CSSProperties = {
  "background-color": hexToRgba(palette.TERM_FLIP, 0.16),
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
  "[&_td]:[text-overflow:clip]!",
  "[&_.paper-tanstack-scroll]:overflow-y-auto",
  "[&_.paper-tanstack-scroll]:[scrollbar-width:thin]",
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
  // sticky header. Pin it directly below the header: ATM plus the row under it
  // are both full, and the sliver below is the vertical scroll cue.
  const inset =
    scroller.clientHeight <= OI_CHAIN_MOBILE_VIEWPORT_MAX
      ? OI_CHAIN_HEADER_HEIGHT
      : (viewport.height - target.height) / 2;
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

  let wrapEl: HTMLDivElement | undefined;
  const attachWrap = (el: HTMLDivElement | undefined) => {
    wrapEl = el;
    props.wrapRef?.(el);
  };

  createEffect(() => {
    const strikes = props.strikes;
    const columns = props.columns;
    if (strikes.length === 0 || columns.length === 0) return;
    // The table stamps its rows after this effect; centre once they are in the DOM.
    queueMicrotask(() => centreChainAtm(wrapEl));
  });

  return (
    <CompactPanel
      flush
      scrollable
      title={<ReportPanelTitle>Option-chain OI (±750 ATM)</ReportPanelTitle>}
      testId={props.panelTestId}
      action={
        <Box className="flex items-center gap-1">
          <Text
            data-testid="nifty-chain-scroll-cue"
            aria-hidden="true"
            className="hidden max-[600px]:inline-flex whitespace-nowrap text-ui-micro font-bold"
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
        data-chain-v-scroll="1"
        data-chain-mobile-row={OI_CHAIN_MOBILE_ROW_PX}
        role="region"
        aria-label="Option chain"
        tabIndex={0}
        onKeyDown={onChainRegionKeyDown}
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
    </CompactPanel>
  );
}
