// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { AnalyticsExpiryOption, AnalyticsStripContext } from "./AnalyticsTabStrip";
import { AnalyticsTabStrip } from "./AnalyticsTabStrip";
import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import type { AnalyticsTab } from "./types";

afterEach(cleanup);

function analytics(): OptionsAnalytics {
  return {
    symbol: "NIFTY",
    spot: 2980,
    asOf: null,
    quotesLive: true,
    expiries: [
      {
        date: "2026-11-23",
        dte: 6,
        atmIv: 79.7,
        rr25: -6.5,
        bf25: 2,
        slope: null,
        fitR2: 0.9,
        points: [
          { strike: 2900, moneyness: null, iv: 86.2, delta: -0.25, oi: 100 },
          { strike: 2980, moneyness: null, iv: 79.7, delta: 0.5, oi: 100 },
        ],
      },
      {
        date: "2026-12-29",
        dte: 42,
        atmIv: 99.7,
        rr25: null,
        bf25: null,
        slope: null,
        fitR2: null,
        points: [
          { strike: 2900, moneyness: null, iv: 105, delta: -0.25, oi: 100 },
          { strike: 2980, moneyness: null, iv: 99.7, delta: 0.5, oi: 100 },
        ],
      },
    ],
    term: [],
    surface: {
      strikes: [2900, 2980],
      expiries: ["2026-11-23", "2026-12-29"],
      iv: [
        [86, 80],
        [105, 100],
      ],
      missing: [
        [false, false],
        [false, false],
      ],
    },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: 2950,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: null,
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
  };
}

const expiries: AnalyticsExpiryOption[] = [
  { date: "2026-11-23", dteDays: 6 },
  { date: "2026-12-29", dteDays: 42 },
  { date: "2027-01-25", dteDays: 69 },
];

const context: AnalyticsStripContext = {
  symbol: "NIFTY",
  expiry: expiries[0],
  spot: 2980,
  atmIv: 79.7,
  marketState: "closed",
};

type StripProps = {
  value?: AnalyticsTab;
  onChange?: (tab: AnalyticsTab) => void;
  onRefresh?: () => void;
  headline?: string;
  symbol?: string | null;
  context?: AnalyticsStripContext;
  data?: OptionsAnalytics | null;
  maxPain?: number | null;
  expiryOptions?: AnalyticsExpiryOption[];
  selectedExpiry?: string | null;
  onSelectExpiry?: (date: string) => void;
  onOpenPillars?: () => void;
};

function strip(props: StripProps = {}) {
  return (
    <UIProvider>
      <AnalyticsTabStrip
        value={props.value}
        onChange={props.onChange ?? vi.fn<(tab: AnalyticsTab) => void>()}
        onRefresh={props.onRefresh}
        headline={props.headline}
        symbol={props.symbol}
        context={props.context}
        data={props.data}
        maxPain={props.maxPain}
        expiryOptions={props.expiryOptions}
        selectedExpiry={props.selectedExpiry}
        onSelectExpiry={props.onSelectExpiry}
        onOpenPillars={props.onOpenPillars}
      />
    </UIProvider>
  );
}

describe("AnalyticsTabStrip", () => {
  test("defaults to PAYOFF with a roving tabIndex", () => {
    render(() => strip());
    const payoff = screen.getByTestId("analytics-tab-payoff");
    expect(payoff).toHaveAttribute("aria-selected", "true");
    expect(payoff).toHaveAttribute("tabindex", "0");

    const smile = screen.getByTestId("analytics-tab-smile");
    expect(smile).toHaveAttribute("aria-selected", "false");
    expect(smile).toHaveAttribute("tabindex", "-1");
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });

  test("question-first labels replace the greek shorthand but keep the testids", () => {
    render(() => strip());
    const labels: Record<AnalyticsTab, string> = {
      payoff: "PAYOFF",
      smile: "IV BY STRIKE",
      term: "IV BY EXPIRY",
      surface: "IV MAP",
      prob: "POSITION ODDS",
    };
    for (const [tab, label] of Object.entries(labels)) {
      expect(screen.getByTestId(`analytics-tab-${tab}`)).toHaveTextContent(label);
    }
  });

  test("a controlled value drives aria-selected", () => {
    render(() => strip({ value: "surface" }));
    expect(screen.getByTestId("analytics-tab-surface")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("analytics-tab-payoff")).toHaveAttribute("aria-selected", "false");
  });

  test("clicking a tab selects it and calls onChange", () => {
    const onChange = vi.fn<(tab: AnalyticsTab) => void>();
    render(() => strip({ onChange }));
    fireEvent.click(screen.getByTestId("analytics-tab-term"));

    expect(onChange).toHaveBeenCalledWith("term");
    expect(screen.getByTestId("analytics-tab-term")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("analytics-tab-payoff")).toHaveAttribute("aria-selected", "false");
  });

  test("Left/Right/Home/End move focus and select, wrapping at the ends", () => {
    const onChange = vi.fn<(tab: AnalyticsTab) => void>();
    render(() => strip({ onChange }));
    const tab = (name: string) => screen.getByTestId(`analytics-tab-${name}`);

    fireEvent.keyDown(tab("payoff"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("smile");
    expect(document.activeElement).toBe(tab("smile"));

    fireEvent.keyDown(tab("smile"), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("prob");
    expect(document.activeElement).toBe(tab("prob"));

    fireEvent.keyDown(tab("prob"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("payoff");

    fireEvent.keyDown(tab("payoff"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("prob");

    fireEvent.keyDown(tab("prob"), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("payoff");

    fireEvent.keyDown(tab("payoff"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  test("refresh is optional and fires its callback", () => {
    render(() => strip());
    expect(screen.queryByTestId("analytics-refresh")).not.toBeInTheDocument();

    cleanup();
    const onRefresh = vi.fn<() => void>();
    render(() => strip({ onRefresh }));
    fireEvent.click(screen.getByTestId("analytics-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("the tab list and chip lanes scroll instead of wrapping", () => {
    render(() =>
      strip({ data: analytics(), maxPain: 2950, expiryOptions: expiries, selectedExpiry: "2026-11-23" }),
    );
    const list = screen.getByRole("tablist");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.style.getPropertyValue("scrollbar-width")).toBe("none");

    for (const id of ["analytics-verdict-chips", "analytics-expiry-chips"]) {
      const lane = screen.getByTestId(id);
      expect(lane.className).toContain("overflow-x-auto");
      expect(lane.className).toContain("whitespace-nowrap");
      expect(lane.className).not.toContain("flex-wrap");
    }
  });

  test("the headline is hidden below the sm breakpoint", () => {
    render(() => strip({ headline: "NIFTY · 3 expiries" }));
    const headline = screen.getByTestId("analytics-headline");
    expect(headline).toHaveTextContent("NIFTY · 3 expiries");
    expect(headline.className).toContain("hidden");
    expect(headline.className).toContain("sm:block");
  });

  test("the context line shows only the values that exist", () => {
    render(() => strip({ context }));
    expect(screen.getByTestId("analytics-context")).toHaveTextContent(
      "NIFTY · 23 NOV · 6d · spot ₹2,980 · IV 79.7% · CLOSED",
    );
  });

  test("the context line tolerates a cold dock", () => {
    render(() => strip());
    expect(screen.getByTestId("analytics-context")).toHaveTextContent("—");
  });

  test("verdict chips come from the payload with stable testids", () => {
    render(() =>
      strip({
        context,
        data: analytics(),
        maxPain: 2950,
        selectedExpiry: "2026-11-23",
      }),
    );
    expect(screen.getByTestId("analytics-chip-rr")).toHaveTextContent("PUTS RICH-6.5 vp");
    expect(screen.getByTestId("analytics-chip-term-value")).toHaveTextContent("CONTANGO");
    expect(screen.getByTestId("analytics-chip-coverage")).toHaveTextContent("100% QUOTED");
    expect(screen.getByTestId("analytics-chip-maxpain")).toHaveTextContent("₹2,950");
    expect(screen.getByTestId("analytics-chip-rr-value").style.color).toContain(
      "var(--color-fin-negative)",
    );
  });

  test("expiry chips call onSelectExpiry and mark the selected one", () => {
    const onSelectExpiry = vi.fn<(date: string) => void>();
    render(() =>
      strip({
        expiryOptions: expiries,
        selectedExpiry: "2026-11-23",
        onSelectExpiry,
      }),
    );
    const front = screen.getByTestId("analytics-expiry-2026-11-23");
    const next = screen.getByTestId("analytics-expiry-2026-12-29");
    expect(front).toHaveTextContent("23 NOV 6d");
    expect(front).toHaveAttribute("aria-pressed", "true");
    expect(next).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(next);
    expect(onSelectExpiry).toHaveBeenCalledWith("2026-12-29");
    expect(screen.getByTestId("analytics-expiry-2027-01-25")).toHaveTextContent("25 JAN 69d");
  });

  test("How to read opens an accessible popover with three bullets for the active tab", () => {
    render(() => strip({ value: "smile" }));
    const button = screen.getByTestId("analytics-help");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("analytics-help-popover")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const popover = screen.getByTestId("analytics-help-popover");
    expect(popover).toHaveAttribute("role", "dialog");
    expect(popover).toHaveTextContent("IV BY STRIKE");
    expect(popover).toHaveTextContent(
      "Left of spot = puts, right = calls. Higher = option market prices a bigger move.",
    );
    expect(screen.getAllByTestId(/analytics-help-bullet-/)).toHaveLength(3);
  });

  test("the popover closes on Escape without leaking the key to the dock", () => {
    render(() => strip());
    fireEvent.click(screen.getByTestId("analytics-help"));
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(escape);

    expect(screen.queryByTestId("analytics-help-popover")).not.toBeInTheDocument();
    expect(screen.getByTestId("analytics-help")).toHaveAttribute("aria-expanded", "false");
  });

  test("the popover closes on an outside click and on a second button click", () => {
    render(() => strip());
    const button = screen.getByTestId("analytics-help");

    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("analytics-help-popover")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByTestId("analytics-help-popover")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByTestId("analytics-help-popover")).not.toBeInTheDocument();
  });

  test("each tab has its own plain-English explanation", () => {
    const lines: Record<AnalyticsTab, string> = {
      payoff: "Green means profit",
      smile: "Left of spot = puts",
      term: "ATM IV at each expiry",
      surface: "One row per expiry, one column per strike",
      prob: "Your legs under a flat-vol model",
    };
    for (const [tab, text] of Object.entries(lines) as [AnalyticsTab, string][]) {
      cleanup();
      render(() => strip({ value: tab }));
      fireEvent.click(screen.getByTestId("analytics-help"));
      expect(screen.getByTestId("analytics-help-bullet-0")).toHaveTextContent(text);
    }
  });
});

describe("AnalyticsTabStrip — in-dock analytics", () => {
  test("the analytics control is a button that calls onOpenPillars, never a route hop", () => {
    const onOpenPillars = vi.fn<() => void>();
    render(() => strip({ symbol: "AAPL", onOpenPillars }));

    const button = screen.getByTestId("analytics-pillars-open");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-label", "Open full analytics for AAPL");
    expect(button).toHaveTextContent("Analytics");
    expect(button).not.toHaveAttribute("href");
    expect(button.closest("a")).toBeNull();

    fireEvent.click(button);
    expect(onOpenPillars).toHaveBeenCalledTimes(1);
  });

  test("exists only when both a symbol and the handler are present", () => {
    render(() => strip({ onOpenPillars: vi.fn() }));
    expect(screen.queryByTestId("analytics-pillars-open")).not.toBeInTheDocument();

    cleanup();
    render(() => strip({ symbol: null, context: { spot: 2980 }, onOpenPillars: vi.fn() }));
    expect(screen.queryByTestId("analytics-pillars-open")).not.toBeInTheDocument();

    cleanup();
    render(() => strip({ context: { symbol: "—" }, onOpenPillars: vi.fn() }));
    expect(screen.queryByTestId("analytics-pillars-open")).not.toBeInTheDocument();

    // A symbol without a host handler would be a dead end — no button.
    cleanup();
    render(() => strip({ symbol: "AAPL" }));
    expect(screen.queryByTestId("analytics-pillars-open")).not.toBeInTheDocument();

    cleanup();
    render(() => strip({ context }));
    expect(screen.queryByTestId("analytics-pillars-open")).not.toBeInTheDocument();
  });

  test("falls back to the context symbol when no dedicated prop is given", () => {
    render(() => strip({ context, onOpenPillars: vi.fn() }));
    expect(screen.getByTestId("analytics-pillars-open")).toHaveAttribute(
      "aria-label",
      "Open full analytics for NIFTY",
    );
  });

  test("keeps one non-wrapping 22px row with an icon-only control at 390", () => {
    render(() =>
      strip({
        symbol: "BRK.B",
        onOpenPillars: vi.fn(),
        onRefresh: vi.fn(),
        headline: "BRK.B · 3 expiries",
      }),
    );

    const button = screen.getByTestId("analytics-pillars-open") as HTMLElement;
    // The wordmark collapses below sm; only the glyph remains so the control
    // cannot wrap the tab list into a second line in the fixed 22px row.
    const label = button.querySelector("span")!;
    expect(label).toHaveTextContent("Analytics");
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("sm:inline");
    expect(button.className).toContain("h-[22px]");
    expect(button.className).toContain("shrink-0");
    expect(button.className).not.toContain("w-full");

    const list = screen.getByRole("tablist");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.parentElement!.className).not.toContain("flex-wrap");
    for (const id of ["analytics-context-row", "analytics-meta-row"]) {
      expect(screen.getByTestId(id).className).not.toContain("flex-wrap");
    }
  });
});
