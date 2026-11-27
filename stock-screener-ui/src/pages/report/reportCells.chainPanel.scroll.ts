import {
  OI_CHAIN_HEADER_HEIGHT,
  OI_CHAIN_MOBILE_VIEWPORT_MAX,
} from "./reportCells.chainMetrics";

const OI_CHAIN_SCROLL_STEP = 80;

/** Arrow keys must scroll the same node that carries focus and `role=region`. */
export function onChainRegionKeyDown(event: KeyboardEvent) {
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
export function centreChainAtm(root: HTMLElement | undefined): void {
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
