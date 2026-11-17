import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Box, Text } from "@/ui";
import { IconRefresh } from "@/components/common/Icons";
import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import { selectedExpiryLabel, verdictChips, type VerdictChip } from "./analyticsRead";
import { ANALYTICS_TABS, type AnalyticsTab, type AnalyticsTone } from "./types";

const LABELS: Record<AnalyticsTab, string> = {
  payoff: "PAYOFF",
  smile: "IV BY STRIKE",
  term: "IV BY EXPIRY",
  surface: "IV MAP",
  prob: "POSITION ODDS",
};

const TONE_VAR: Record<AnalyticsTone, string> = {
  positive: "var(--color-fin-positive)",
  negative: "var(--color-fin-negative)",
  warning: "var(--color-fin-warning)",
  info: "var(--color-fin-info)",
  neutral: "var(--color-fin-text-muted)",
};

/** Question-first explanations: what each tab answers, in operator language. */
const HELP: Record<AnalyticsTab, string[]> = {
  payoff: [
    "Green means profit and red means loss if expiry lands at that price.",
    "The dotted line is today's spot; the curve crosses zero at your breakevens.",
    "Wider wings survive bigger moves but cost more premium to carry.",
  ],
  smile: [
    "Left of spot = puts, right = calls. Higher = option market prices a bigger move.",
    "The 25Δ RR compares the two wings — negative means puts are bid.",
    "A kink or a gap usually marks a thin strike; trust the smooth middle more.",
  ],
  term: [
    "ATM IV at each expiry.",
    "Falling = near-term panic/event premium; rising = later risk priced higher.",
    "A steep drop after an event means the premium was about the date, not the trend.",
  ],
  surface: [
    "One row per expiry, one column per strike.",
    "Blank/hatched = no valid quote, never a zero-vol point.",
    "Read down a column for the passing of time, across a row for the strike skew.",
  ],
  prob: [
    "Your legs under a flat-vol model: chance of profit, expected P&L, ±1σ move.",
    "The model prices price, not news — an earnings gap can break it.",
    "Compare flat and skewed POP: a big gap means the smile matters here.",
  ],
};

export interface AnalyticsExpiryOption {
  date: string;
  dteDays?: number | null;
  dte?: number | null;
}

export interface AnalyticsStripContext {
  symbol?: string | null;
  expiry?: { date: string; dteDays?: number | null; dte?: number | null } | null;
  spot?: number | null;
  atmIv?: number | null;
  marketState?: string | null;
}

const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

/** Only values that actually exist — no `₹0`, no `—%` clutter. */
function contextLine(ctx: AnalyticsStripContext | undefined): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.symbol) parts.push(ctx.symbol);
  if (ctx.expiry?.date) parts.push(selectedExpiryLabel(ctx.expiry, ctx.expiry.dteDays ?? ctx.expiry.dte));
  if (finite(ctx.spot) && ctx.spot > 0) {
    parts.push(`spot ₹${ctx.spot.toLocaleString("en-IN", { maximumFractionDigits: 1 })}`);
  }
  if (finite(ctx.atmIv)) parts.push(`IV ${ctx.atmIv.toFixed(1)}%`);
  if (ctx.marketState) parts.push(ctx.marketState === "closed" ? "CLOSED" : "OPEN");
  return parts.join(" · ");
}

/**
 * The analytics shell: five question-first tabs over a persistent context line,
 * computed verdict chips and an in-band expiry picker. Presentational — the
 * host owns the active tab, the selected expiry and the payload.
 *
 * Each row is a fixed height and scrolls horizontally instead of wrapping, so
 * the 206px analytics band never grows at 390px.
 */
export function AnalyticsTabStrip(props: {
  /** Omit for uncontrolled use; the strip starts on PAYOFF. */
  value?: AnalyticsTab;
  onChange: (tab: AnalyticsTab) => void;
  headline?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  testId?: string;
  /** Real dock symbol. The context line uses "—" as a no-symbol placeholder. */
  symbol?: string | null;
  context?: AnalyticsStripContext;
  data?: OptionsAnalytics | null;
  maxPain?: number | null;
  expiryOptions?: AnalyticsExpiryOption[];
  selectedExpiry?: string | null;
  onSelectExpiry?: (date: string) => void;
  /**
   * Opens the four-pillar view inside the host (the dock). Presentational: the
   * host owns the mode, so the strip never navigates away from the dock. The
   * button only exists when both a symbol and this handler are present.
   */
  onOpenPillars?: () => void;
}) {
  const isControlled = () => props.value !== undefined;
  const [internal, setInternal] = createSignal<AnalyticsTab>("payoff");
  const [helpOpen, setHelpOpen] = createSignal(false);
  const active = () => (isControlled() ? props.value! : internal());
  let refs: (HTMLButtonElement | null)[] = [];
  let helpButton: HTMLButtonElement | null = null;
  let popover: HTMLDivElement | null = null;

  const select = (tab: AnalyticsTab) => {
    if (!isControlled()) setInternal(tab);
    props.onChange(tab);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = ANALYTICS_TABS.indexOf(active());
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + ANALYTICS_TABS.length) % ANALYTICS_TABS.length;
    else if (event.key === "ArrowRight") next = (index + 1) % ANALYTICS_TABS.length;
    else if (event.key === "Home") next = 0;
    else next = ANALYTICS_TABS.length - 1;
    const tab = ANALYTICS_TABS[next];
    refs[next]?.focus();
    select(tab);
  };

  // The popover owns Escape while it is open: a capture listener stops the
  // dock's bubble-phase handler from treating it as "close the whole dock".
  createEffect(() => {
    if (!helpOpen()) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setHelpOpen(false);
      helpButton?.focus({ preventScroll: true });
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || popover?.contains(target) || helpButton?.contains(target)) return;
      setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    });
  });

  const line = createMemo(() => contextLine(props.context));
  const chips = createMemo(() =>
    verdictChips({
      data: props.data ?? null,
      selectedExpiry: props.selectedExpiry ?? null,
      atmIv: props.context?.atmIv ?? null,
      maxPain: props.maxPain ?? null,
      spot: props.context?.spot ?? 0,
    }),
  );
  const options = createMemo(() => props.expiryOptions ?? []);
  const linkSymbol = createMemo(() => {
    const symbol = (props.symbol ?? props.context?.symbol)?.trim();
    return symbol && symbol !== "—" ? symbol : null;
  });
  const canOpenPillars = createMemo(() => linkSymbol() != null && props.onOpenPillars != null);

  return (
    <Box
      className="relative flex w-full min-w-0 shrink-0 flex-col border-b border-fin-border"
      data-testid={props.testId ?? "analytics-tab-strip"}
    >
      {/* Row 1 — five tabs, help, refresh. The list alone scrolls. */}
      <Box className="flex h-[22px] min-w-0 items-center">
        <div
          role="tablist"
          aria-label="Options analytics"
          className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto"
          style={{ "scrollbar-width": "none" }}
          onKeyDown={onKeyDown}
          data-testid="analytics-tabs-list"
        >
          <For each={ANALYTICS_TABS}>
            {(tab) => (
              <button
                ref={(node) => (refs[ANALYTICS_TABS.indexOf(tab)] = node)}
                type="button"
                role="tab"
                aria-selected={active() === tab}
                tabIndex={active() === tab ? 0 : -1}
                data-testid={`analytics-tab-${tab}`}
                title={LABELS[tab]}
                onClick={() => select(tab)}
                className={`inline-flex shrink-0 items-center justify-center border-b-2 px-2 font-mono outline-none focus-visible:ring-1 focus-visible:ring-fin-primary ${
                  active() === tab
                    ? "border-fin-primary text-fin-text"
                    : "border-transparent text-fin-text-muted hover:text-fin-text"
                }`}
                style={{ "font-size": "9px", "letter-spacing": "0.06em", "line-height": "1" }}
              >
                {LABELS[tab]}
              </button>
            )}
          </For>
        </div>
        <Show when={props.headline}>
          <Text
            size="xs"
            c="dimmed"
            className="hidden shrink-0 truncate pl-2 font-mono sm:block"
            style={{ "font-size": "9px" }}
            data-testid="analytics-headline"
          >
            {props.headline}
          </Text>
        </Show>
        <button
          ref={(node) => (helpButton = node)}
          type="button"
          aria-label="How to read options analytics"
          aria-haspopup="dialog"
          aria-expanded={helpOpen()}
          data-testid="analytics-help"
          onClick={() => setHelpOpen((open) => !open)}
          className="ml-1 inline-flex h-[22px] shrink-0 items-center border-0 bg-transparent p-0 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary"
        >
          <span className="hidden sm:inline">How to read</span>
          <span className="sm:hidden">?</span>
        </button>
        <Show when={props.onRefresh}>
          <button
            type="button"
            aria-label="Refresh analytics"
            data-testid="analytics-refresh"
            disabled={props.refreshing}
            onClick={() => props.onRefresh?.()}
            className="ml-1 inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted hover:text-fin-primary disabled:opacity-50"
          >
            <IconRefresh size={12} />
          </button>
        </Show>
        <Show when={canOpenPillars()}>
          <button
            type="button"
            aria-label={`Open full analytics for ${linkSymbol()}`}
            data-testid="analytics-pillars-open"
            onClick={() => props.onOpenPillars?.()}
            className="ml-1 inline-flex h-[22px] shrink-0 items-center justify-center gap-0.5 whitespace-nowrap border-0 bg-transparent p-0 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-fin-text-muted hover:text-fin-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary"
          >
            <span className="hidden sm:inline">Analytics</span>
            <span aria-hidden="true">▤</span>
          </button>
        </Show>
      </Box>

      {/* Row 2 — the context survives every tab switch. */}
      <Box className="flex h-[16px] min-w-0 items-center px-1" data-testid="analytics-context-row">
        <Text
          size="xs"
          c={line() ? "normal" : "dimmed"}
          className="min-w-0 truncate font-mono tabular-nums"
          style={{ "font-size": "9px", "line-height": "1.1" }}
          data-testid="analytics-context"
        >
          {line() || "—"}
        </Text>
      </Box>

      {/* Row 3 — verdicts and expiry chips, each in its own scroll lane. */}
      <Box className="flex h-[18px] min-w-0 items-center gap-1 px-1" data-testid="analytics-meta-row">
        <div
          className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap"
          style={{ "scrollbar-width": "none" }}
          data-testid="analytics-verdict-chips"
        >
          <For each={chips()}>
            {(chip: VerdictChip) => (
              <span
                data-testid={chip.testId}
                title={chip.title}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono"
                style={{ "font-size": "9px", "line-height": "1" }}
              >
                <span className="text-fin-text-muted">{chip.label}</span>
                <span
                  className="font-mono font-semibold tabular-nums"
                  style={{ color: TONE_VAR[chip.tone] }}
                  data-testid={`${chip.testId}-value`}
                >
                  {chip.value}
                </span>
                <Show when={chip.text}>
                  <span className="font-mono tabular-nums text-fin-text-muted">{chip.text}</span>
                </Show>
              </span>
            )}
          </For>
        </div>
        <Show when={options().length > 0}>
          <div
            className="flex h-full max-w-[45%] shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-l border-fin-border pl-1"
            style={{ "scrollbar-width": "none" }}
            data-testid="analytics-expiry-chips"
          >
            <For each={options()}>
              {(option) => (
                <button
                  type="button"
                  aria-pressed={props.selectedExpiry === option.date}
                  data-testid={`analytics-expiry-${option.date}`}
                  onClick={() => props.onSelectExpiry?.(option.date)}
                  className={`inline-flex h-[16px] shrink-0 items-center border px-1 font-mono text-[9px] tabular-nums leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-primary ${
                    props.selectedExpiry === option.date
                      ? "border-fin-primary bg-fin-surface-alt text-fin-text"
                      : "border-fin-border bg-transparent text-fin-text-muted hover:text-fin-text"
                  }`}
                  style={{ "border-radius": "4px" }}
                >
                  {selectedExpiryLabel(option, option.dteDays ?? option.dte, " ")}
                </button>
              )}
            </For>
          </div>
        </Show>
      </Box>

      <Show when={helpOpen()}>
        <div
          ref={(node) => (popover = node)}
          role="dialog"
          aria-label="How to read options analytics"
          data-testid="analytics-help-popover"
          className="absolute z-30 w-[280px] max-w-[calc(100vw-16px)] border border-fin-border bg-fin-surface p-2 shadow-lg"
          style={{ "border-radius": "6px" }}
        >
          <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-fin-text">
            How to read · {LABELS[active()]}
          </div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
            <For each={HELP[active()]}>
              {(bullet, index) => (
                <li
                  data-testid={`analytics-help-bullet-${index()}`}
                  className="font-mono text-[9px] leading-[1.4] text-fin-text-muted"
                >
                  {bullet}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </Box>
  );
}
