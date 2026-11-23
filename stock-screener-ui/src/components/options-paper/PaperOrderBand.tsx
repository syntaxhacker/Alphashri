import { createMemo, createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Alert, Badge, Box, Button, NumberInput, Text, ToolbarRow } from "@/ui";
import { showSuccess } from "@/ui/notifications";
import {
  fetchReplaySessions,
  placeOptionPaperOrder,
  previewOptionPaperOrder,
} from "@/api/optionsPaper";
import { useSymbolDock } from "@/components/common/symbolDockContext";
import { optionsDockState } from "@/state/optionsDock";
import { setPendingOrder, setReplay, upsertPosition } from "@/state/optionsPaper";
import { formatCurrencyCompact } from "@/utils/ui-helpers";
import { DockSection } from "@/components/options-dock/DockSection";
import { reducedMotionClass, transitionClass } from "@/pages/options-replay/replayMotion";
import {
  buildOrderRequest,
  validateOrderRequest,
  type OrderChainLadder,
  type OrderLegInput,
  type PaperOrderRequest,
} from "./optionOrder.spec";
import type { OptionPaperSource, ReplaySession } from "@/types/optionsPaper";

// Mirrors the options_paper charge schedule: per-order brokerage plus STT on
// sold premium. This is an estimate for the ticket, not the booked cost.
const BROKERAGE_PER_ORDER = 30;
const STT_SELL_RATE = 0.0015;

// 09:47 IST sits inside the earliest recorded chain window (IRFC 09:47–10:13).
const SESSION_ENTRY_TIME = "09:47:00+05:30";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function istWeekday(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).formatToParts(date);
  return WEEKDAYS.indexOf(parts.find((part) => part.type === "weekday")?.value ?? "Mon");
}

/** Five NSE sessions back, skipping weekends; the replay's default entry. */
function fiveSessionsBackIso(now: Date = new Date()): string {
  const cursor = new Date(now.getTime());
  let sessions = 0;
  while (sessions < 5) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const weekday = istWeekday(cursor);
    if (weekday !== 0 && weekday !== 6) sessions += 1;
  }
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(cursor);
  return `${date}T09:15:00+05:30`;
}

interface EntryChoice {
  entryTs: string;
  recorded: boolean;
}

/**
 * Prefer the latest recorded session date for this underlying that is not
 * after the naive five-session date; when every session is newer (the common
 * stale-batch case) take the earliest recorded one. Falls back to the naive
 * timestamp when nothing is recorded.
 */
function chooseEntryTs(
  sessions: readonly ReplaySession[],
  underlying: string,
  naiveIso: string,
): EntryChoice {
  const naiveDate = naiveIso.slice(0, 10);
  const dates = sessions
    .filter((session) => session.underlying?.toUpperCase() === underlying)
    .map((session) => session.date?.slice(0, 10) ?? "")
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  if (dates.length === 0) return { entryTs: naiveIso, recorded: false };
  const notAfter = dates.filter((date) => date <= naiveDate);
  const chosen = notAfter.length ? notAfter[notAfter.length - 1] : dates[0];
  return { entryTs: `${chosen}T${SESSION_ENTRY_TIME}`, recorded: true };
}

/** Short, actionable guidance when no historical chain was recorded for the symbol. */
function noSessionMessage(underlying: string, sessions: readonly ReplaySession[]): string {
  const otherSymbols = new Set(
    sessions
      .map((session) => session.underlying?.toUpperCase() ?? "")
      .filter((symbol) => symbol.length > 0 && symbol !== underlying),
  );
  const context = otherSymbols.size === 0
    ? `No recorded history for ${underlying}.`
    : `No recorded history for ${underlying} (${otherSymbols.size} other symbols have it).`;
  return `${context} Place a live paper trade or pick another symbol.`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PaperOrderBandProps {
  symbol: string;
  expiry: string;
  legs: readonly OrderLegInput[];
  chainLadder?: OrderChainLadder;
}

export function PaperOrderBand(props: PaperOrderBandProps) {
  const navigate = useNavigate();
  const dock = useSymbolDock();
  const [lots, setLots] = createSignal(1);
  const [slippage, setSlippage] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const hasShort = createMemo(() => props.legs.some((leg) => leg.side === "sell"));
  const estimate = createMemo(() => {
    const qty = Math.max(1, Math.floor(lots()));
    let debit = 0;
    let soldPremium = 0;
    for (const leg of props.legs) {
      const lotSize = leg.lotSize && leg.lotSize > 0 ? leg.lotSize : 1;
      const units = qty * lotSize;
      if (leg.side === "sell") {
        debit -= units * leg.premium;
        soldPremium += units * leg.premium;
      } else {
        debit += units * leg.premium;
      }
    }
    return {
      debit,
      costs: props.legs.length * BROKERAGE_PER_ORDER + soldPremium * STT_SELL_RATE,
    };
  });

  const makeRequest = (source: OptionPaperSource, entryTs?: string): PaperOrderRequest =>
    buildOrderRequest({
      symbol: props.symbol,
      expiry: props.expiry,
      legs: props.legs,
      lots: lots(),
      slippageTicks: slippage(),
      chainLadder: props.chainLadder,
      source,
      entryTs,
    });

  const guard = (req: PaperOrderRequest): boolean => {
    const errors = validateOrderRequest(req);
    if (errors.length === 0) return true;
    setError(errors.join(" · "));
    return false;
  };

  const place = async () => {
    if (loading()) return;
    setError(null);
    try {
      const req = makeRequest("live");
      if (!guard(req)) return;
      setLoading(true);
      const result = await placeOptionPaperOrder({ ...req, source: "live" });
      if (result.position) upsertPosition(result.position);
      showSuccess(
        "Paper order placed",
        `${req.underlying} ${req.legs.length}-leg structure is open as PAPER`,
      );
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  };

  const replay = async () => {
    if (loading()) return;
    setError(null);
    setLoading(true);
    const underlying = props.symbol.toUpperCase();
    try {
      // Discovery is best-effort: a failed/timed-out lookup must not block the
      // preview, which still gets a best-guess five-session entry. A successful
      // lookup with no chain for this underlying is different — submitting that
      // preview is knowingly doomed (HTTP 400), so stop and explain instead.
      let sessions: ReplaySession[] = [];
      let discovered = false;
      try {
        sessions = await fetchReplaySessions();
        discovered = true;
      } catch {
        // Fall through to the naive date.
      }
      if (discovered && !sessions.some((s) => s.underlying?.toUpperCase() === underlying)) {
        setError(noSessionMessage(underlying, sessions));
        return;
      }
      const choice = chooseEntryTs(sessions, underlying, fiveSessionsBackIso());
      const req = makeRequest("replay", choice.entryTs);
      if (!guard(req)) return;
      const preview = await previewOptionPaperOrder({ ...req, source: "replay", entryTs: req.entryTs });
      // Hand the structure AND its preview to the replay page so the route
      // transition does not pay for a second identical API call.
      setReplay(preview);
      setPendingOrder({
        ...req,
        source: "replay",
        entryTs: req.entryTs,
        atmIv: optionsDockState.chain?.atmIv ?? null,
      });
      // The dock is app-wide; leaving it open would cover the replay page on a
      // 390px bottom sheet.
      dock.close();
      const query = new URLSearchParams({ underlying: req.underlying, expiry: req.expiry });
      navigate(`/options/replay?${query.toString()}`);
    } catch (failure) {
      const detail = errorText(failure);
      setError(
        /chain snapshot|entryTs/i.test(detail)
          ? `No recorded chain snapshot for ${underlying} at the selected entry time. ${detail}`
          : detail,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <DockSection
      title="PAPER ORDER"
      testId="paper-order-band"
      headerTestId="dock-section-paper-order"
      header={
        <Box className="flex h-full min-w-0 flex-1 items-center gap-2 px-2">
          <Text size="xs" fw={700} className="shrink-0 font-mono uppercase tracking-[0.06em]">
            PAPER ORDER
          </Text>
          <Badge size="sm" color="info" variant="light" style={{ "font-size": "11px", height: "20px" }}>
            SIMULATED
          </Badge>
          <Text c="dimmed" truncate className="min-w-0 flex-1 text-right text-[11px]">
            No real funds · fills at chain LTP
          </Text>
        </Box>
      }
    >
      <ToolbarRow gap={12} data-testid="paper-order-controls">
        <Box className="flex min-w-[90px] flex-1 flex-col gap-1" data-testid="paper-order-type-field">
          <Text size="xs" c="dimmed" className="uppercase">TYPE</Text>
          <Box className="flex h-[30px] min-w-0 items-center rounded-[6px] border border-fin-border-subtle bg-fin-surface px-2">
            <Badge
              size="sm"
              variant="outline"
              color="info"
              style={{ "font-size": "11px", height: "20px" }}
              data-testid="paper-order-type"
              title="Paper orders fill at the live chain LTP plus the slippage ticks below."
            >
              MARKET · LIVE LTP
            </Badge>
          </Box>
        </Box>
        <Box className="flex min-w-[90px] flex-1 flex-col gap-1" data-testid="paper-order-lots-field">
          <Text size="xs" c="dimmed" className="uppercase">LOTS</Text>
          <NumberInput
            size="sm"
            w="100%"
            min={1}
            hideControls
            value={lots()}
            onChange={(value) => setLots(typeof value === "number" ? value : 1)}
            disabled={loading()}
            data-testid="paper-order-lots"
            aria-label="Lots"
          />
        </Box>
        <Box className="flex min-w-[90px] flex-1 flex-col gap-1" data-testid="paper-order-slippage-field">
          <Text size="xs" c="dimmed" className="uppercase">SLIP TICKS</Text>
          <NumberInput
            size="sm"
            w="100%"
            min={0}
            hideControls
            value={slippage()}
            onChange={(value) => setSlippage(typeof value === "number" ? value : 0)}
            disabled={loading()}
            data-testid="paper-order-slippage"
            aria-label="Slippage ticks"
          />
        </Box>
      </ToolbarRow>

      <ToolbarRow
        gap={8}
        className="mt-2 border-t border-fin-border-subtle pt-2"
        data-testid="paper-order-summary"
      >
        <Text size="xs" c="dimmed" className="font-mono tabular-nums" data-testid="paper-order-debit">
          {estimate().debit >= 0 ? "NET DEBIT " : "NET CREDIT "}
          {formatCurrencyCompact(Math.abs(estimate().debit))}
        </Text>
        <Text size="xs" c="dimmed" className="font-mono tabular-nums" data-testid="paper-order-costs">
          ENTRY COSTS {formatCurrencyCompact(estimate().costs)}
        </Text>
        <Show when={hasShort()}>
          <Badge
            size="sm"
            color="warning"
            variant="light"
            style={{ "font-size": "11px", height: "20px" }}
            data-testid="paper-order-margin-warning"
          >
            SELL legs need margin — keep the structure defined-risk
          </Badge>
        </Show>
      </ToolbarRow>

      <Show when={loading()}>
        <Text
          c="dimmed"
          className={`text-[11px] ${transitionClass("state")} ${reducedMotionClass()} animate-pulse motion-reduce:animate-none`}
          data-testid="paper-order-loading"
        >
          Submitting paper order…
        </Text>
      </Show>

      <Show when={error()}>
        {(message) => (
          <Alert color="error" variant="light" data-testid="paper-order-error">
            <Text c="error" className="text-[11px]">{message()}</Text>
          </Alert>
        )}
      </Show>

      <ToolbarRow gap={8} wrap={false} className="mt-1" data-testid="paper-order-actions">
        <Button
          size="md"
          fullWidth
          variant="filled"
          className={`min-w-0 flex-1 ${transitionClass("button")} ${reducedMotionClass()}`}
          disabled={loading()}
          onClick={() => void place()}
          data-testid="paper-order-place"
        >
          PLACE PAPER TRADE
        </Button>
        <Button
          size="md"
          fullWidth
          variant="default"
          className={`min-w-0 flex-1 ${transitionClass("button")} ${reducedMotionClass()}`}
          disabled={loading()}
          onClick={() => void replay()}
          data-testid="paper-order-replay"
        >
          REPLAY THIS STRUCTURE
        </Button>
      </ToolbarRow>
    </DockSection>
  );
}
