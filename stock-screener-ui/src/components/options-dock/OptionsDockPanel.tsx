import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Box, Button, Text, Tooltip, useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconRefresh,
  IconX,
} from "@/components/common/Icons";
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
} from "@/state/optionsDock";
import type { ChainLeg } from "@/api/optionsDock";
import { CHAIN_NARROW_QUERY, OptionChainTable } from "./OptionChainTable";
import { LegBuilder } from "./LegBuilder";
import { StrategyControl } from "./StrategyControl";
import { PayoffPanel } from "./PayoffPanel";
import { SummaryStrip, formatDte } from "./SummaryStrip";
import { DockSection } from "./DockSection";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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
function bannerMessage(error: DockFailure): string {
  switch (error.kind) {
    case "auth":
      return "Reconnect Upstox in Settings";
    case "rate":
    case "rate_limited": {
      const retryAfterMs = optionsDockState.paused?.retryAfterMs ?? 0;
      return retryAfterMs > 0
        ? `Refreshing paused — retry in ${Math.ceil(retryAfterMs / 1000)} s`
        : "Refreshing paused — rate limited";
    }
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
  if (value > 0) return palette.POSITIVE;
  if (value < 0) return palette.NEGATIVE;
  return undefined;
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
      className="inline-flex shrink-0 items-stretch overflow-hidden border border-fin-border"
      style={{ height: "20px", "border-radius": "4px" }}
    >
      <For each={items}>
        {(item) => (
          <button
            type="button"
            aria-pressed={props.value === item.side}
            data-testid={`options-chain-side-${item.side.toLowerCase()}`}
            onClick={() => props.onChange(item.side)}
            className={`inline-flex h-[18px] min-w-[28px] cursor-pointer items-center justify-center border-0 px-1.5 font-mono text-[9px] font-bold leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary ${
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

  onMount(() => {
    // The 0-DTE / EXPIRED labels cross a boundary at 15:40; a 30 s clock is
    // enough to relabel without waking up per frame.
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    onCleanup(() => window.clearInterval(timer));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (maximized()) setMaximized(false);
        else props.onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const symbol = () => optionsDockState.symbol ?? "—";
  const chain = () => optionsDockState.chain;
  const spot = () => chain()?.spot ?? optionsDockState.underlying?.spot ?? 0;
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

  const handlePick = (strike: number, type: "CE" | "PE", leg: ChainLeg, side: "buy" | "sell") => {
    const premium = leg.ltp ?? 0;
    addLeg({ side, type, strike, premium, expiry: optionsDockState.expiry ?? undefined });
  };

  const legs = () => optionsDockState.legs;

  return (
    // The sheet/rail wrappers clip at a fixed height, so the dock is the single
    // scroll owner: a short sheet scrolls instead of clipping LEGS/PAYOFF.
    <Box
      data-testid="options-dock"
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
        className="flex shrink-0 flex-col gap-1 border-b border-fin-border px-2 py-1"
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
              className="min-w-0 cursor-pointer border border-fin-border bg-fin-surface px-1 py-0 font-mono text-[10px] text-fin-text"
              style={{ height: "22px", "border-radius": "4px" }}
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

          <Box className="flex items-center gap-0.5">
            <Show when={optionsDockState.paused}>
              <Tooltip label={`Rate limited — refreshing in ${Math.ceil((optionsDockState.paused?.retryAfterMs ?? 0) / 1000)} s`}>
                <Text
                  size="xs"
                  c="warning"
                  className="font-mono uppercase"
                  style={{ "font-size": "9px" }}
                  data-testid="options-refresh-paused"
                >
                  Refreshing paused
                </Text>
              </Tooltip>
            </Show>
            <Show when={marketClosed() && !optionsDockState.paused}>
              <Text
                size="xs"
                c="dimmed"
                className="font-mono uppercase"
                style={{ "font-size": "9px" }}
                data-testid="options-market-closed"
              >
                {asOfLabel() ? `closed · as of ${asOfLabel()}` : "market closed"}
              </Text>
            </Show>
            <Tooltip label="Refresh">
              <Box
                component="button"
                type="button"
                aria-label="Refresh option chain"
                data-testid="options-refresh"
                onClick={() => void refresh()}
                className="inline-flex h-[22px] w-[22px] items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-primary"
              >
                <IconRefresh size={12} />
              </Box>
            </Tooltip>
            <Tooltip label={maximized() ? "Restore" : "Maximize"}>
              <Box
                component="button"
                type="button"
                aria-label={maximized() ? "Restore options dock" : "Maximize options dock"}
                data-testid="options-maximize"
                onClick={() => setMaximized((v) => !v)}
                className="inline-flex h-[22px] w-[22px] items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-primary"
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
                  close();
                  props.onClose?.();
                }}
                className="inline-flex h-[22px] w-[22px] items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-negative"
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
      <Show when={optionsDockState.status === "error" && optionsDockState.error}>
        <Box
          className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center"
          data-testid="options-dock-error"
        >
          <Text size="sm" fw={600} c="error">
            {optionsDockState.error!.kind === "auth"
              ? "Reconnect Upstox in Settings"
              : optionsDockState.error!.message}
          </Text>
          <Show when={optionsDockState.error!.kind === "auth"}>
            <Text size="xs" c="dimmed">
              The options chain needs a live Upstox session.
            </Text>
          </Show>
          <Button
            size="xs"
            variant="default"
            onClick={() => void refresh()}
            data-testid="options-dock-retry"
          >
            Retry
          </Button>
        </Box>
      </Show>

      <Show when={optionsDockState.status === "empty"}>
        <Box
          className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center"
          data-testid="options-dock-empty"
        >
          <Text size="sm" fw={600}>
            No listed options for {symbol()}
          </Text>
          <Text size="xs" c="dimmed">
            The chart, TradingView and copy actions still work for this symbol.
          </Text>
        </Box>
      </Show>

      <Show
        when={
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
                className="flex flex-1 flex-col items-center justify-center gap-1"
                data-testid="options-dock-loading"
              >
                <Text size="xs" c="dimmed">
                  Loading {symbol()} chain…
                </Text>
              </Box>
            </Show>
          }
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
                <Show when={isNarrow()}>
                  <ChainSideToggle value={chainSide()} onChange={setChainSide} />
                </Show>
                <Text size="xs" c="dimmed" className="font-mono tabular-nums" style={{ "font-size": "9px" }}>
                  {chain()!.rows.length} strikes
                </Text>
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
                className="flex h-[26px] shrink-0 items-center gap-2 overflow-hidden border-l-[3px] bg-fin-surface-alt px-2"
                style={{ "border-left-color": bannerColor(optionsDockState.error!) }}
              >
                <Text
                  size="xs"
                  fw={600}
                  className="min-w-0 flex-1 truncate font-mono"
                  style={{ "font-size": "10px", color: bannerColor(optionsDockState.error!) }}
                >
                  {bannerMessage(optionsDockState.error!)}
                </Text>
                <Box
                  component="button"
                  type="button"
                  aria-label="Retry option chain refresh"
                  data-testid="options-dock-retry"
                  onClick={() => void refresh()}
                  className="inline-flex h-[20px] shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 font-mono text-[10px] font-semibold hover:underline"
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
              loading={optionsDockState.refreshing && chain()!.rows.length === 0}
              onPick={handlePick}
            />
          </DockSection>
          <StrategyControl />
          <LegBuilder
            legs={legs()}
            netPremium={netPremium()}
            currentExpiry={optionsDockState.expiry}
          />
          <Show
            when={legs().length > 0}
            fallback={
              <DockSection title="PAYOFF" testId="options-payoff-placeholder">
                <Text size="xs" c="dimmed">
                  {formatDte(selectedExpiry()?.dteDays ?? 0)} · add a leg to see the
                  payoff
                </Text>
              </DockSection>
            }
          >
            <Box
              className={maximized() ? "flex min-h-0 flex-1" : "flex shrink-0"}
              style={maximized() ? undefined : { height: "206px" }}
            >
              <PayoffPanel
                legs={legs()}
                spot={spot()}
                iv={chain()!.atmIv}
                dteYears={dteYears()}
              />
            </Box>
          </Show>
        </Show>
      </Show>
    </Box>
  );
}
