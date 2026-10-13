// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { UIProvider } from "@/ui";
import {
  ALERT_KIND_CODE,
  ALERT_KIND_LABEL,
  ALERT_SEVERITY,
  MarketAlertCard,
  MarketAlertLog,
  MarketAlertRow,
  MarketAlertStack,
  formatAlertHm,
  formatAlertTime,
  type MarketAlert,
} from "./MarketAlertCard";

function alert(overrides?: Partial<MarketAlert>): MarketAlert {
  return {
    id: "a1",
    kind: "oi_burst",
    severity: "alert",
    symbol: "NIFTY",
    title: "Call ΔOI burst — 22,600 CE",
    detail: "+170.16M added in 3 min",
    metrics: [
      { label: "ΔOI", value: "+170.16M", tone: "up" },
      { label: "Spot", value: "22,551", tone: "neutral" },
    ],
    ts: Date.parse("2026-10-13T14:03:00+05:30"),
    source: "Nifty OI tape",
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: UIProvider });
}

afterEach(() => cleanup());

describe("formatAlertTime", () => {
  test("renders IST HH:MM:SS regardless of host TZ", () => {
    expect(formatAlertTime(Date.parse("2026-10-13T14:03:00+05:30"))).toBe("14:03:00");
    expect(formatAlertTime(Date.parse("2026-10-13T08:33:00Z"))).toBe("14:03:00");
  });

  test("non-finite input yields empty string", () => {
    expect(formatAlertTime(NaN)).toBe("");
  });

  test("formatAlertHm trims to HH:MM", () => {
    expect(formatAlertHm(Date.parse("2026-10-13T14:03:00+05:30"))).toBe("14:03");
  });
});

describe("terminal config", () => {
  test("every kind has a short code and a long label", () => {
    for (const kind of Object.keys(ALERT_KIND_CODE) as (keyof typeof ALERT_KIND_CODE)[]) {
      expect(ALERT_KIND_CODE[kind].length).toBeGreaterThan(0);
      expect(ALERT_KIND_CODE[kind].length).toBeLessThanOrEqual(3);
      expect(ALERT_KIND_LABEL[kind].length).toBeGreaterThan(0);
    }
  });

  test("severity ranks are monotonic and rails are palette tokens", () => {
    const s = ALERT_SEVERITY;
    expect(s.info.rank).toBeLessThan(s.watch.rank);
    expect(s.watch.rank).toBeLessThan(s.alert.rank);
    expect(s.alert.rank).toBeLessThan(s.critical.rank);
    for (const v of Object.values(s)) expect(v.rail).toMatch(/^#|^rgb/);
    // only alert/critical colour their text — greyscale until action is needed
    expect(s.info.emphasize).toBe(false);
    expect(s.watch.emphasize).toBe(false);
    expect(s.alert.emphasize).toBe(true);
    expect(s.critical.emphasize).toBe(true);
  });
});

describe("MarketAlertRow", () => {
  test("renders kind code, symbol, severity, headline, facts and IST on one line", () => {
    r(<MarketAlertRow alert={alert()} />);
    const row = screen.getByTestId("market-alert-oi_burst");
    expect(within(row).getByText("OI")).toBeInTheDocument();
    expect(within(row).getByText("NIFTY")).toBeInTheDocument();
    expect(within(row).getByTestId("market-alert-severity")).toHaveTextContent("Alert");
    expect(within(row).getByText("Call ΔOI burst — 22,600 CE")).toBeInTheDocument();
    expect(within(row).getByText("ΔOI")).toBeInTheDocument();
    expect(within(row).getByText("+170.16M")).toBeInTheDocument();
    expect(within(row).getByText("14:03")).toBeInTheDocument();
  });

  test("row height is fixed (density) and detail lives in the tooltip", () => {
    r(<MarketAlertRow alert={alert()} />);
    const row = screen.getByTestId("market-alert-oi_burst");
    expect(row).toHaveAttribute("title", expect.stringContaining("+170.16M added in 3 min"));
    expect(row).toHaveStyle({ height: "20px" });
  });

  test("severity drives the data attribute", () => {
    r(<MarketAlertRow alert={alert({ severity: "critical" })} />);
    const row = screen.getByTestId("market-alert-oi_burst");
    expect(row.getAttribute("data-severity")).toBe("critical");
    expect(within(row).getByTestId("market-alert-severity")).toHaveTextContent("Critical");
  });

  test("clicking selects/opens; dismiss stops propagation", () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    r(<MarketAlertRow alert={alert()} onOpen={onOpen} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("market-alert-oi_burst"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
    fireEvent.click(screen.getByTestId("market-alert-dismiss"));
    expect(onDismiss).toHaveBeenCalledWith("a1");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("MarketAlertCard", () => {
  test("shows detail, metrics and source (centre density)", () => {
    r(<MarketAlertCard alert={alert()} />);
    const card = screen.getByTestId("market-alert-oi_burst");
    expect(within(card).getByText("+170.16M added in 3 min")).toBeInTheDocument();
    expect(within(card).getByText("Nifty OI tape")).toBeInTheDocument();
    expect(within(card).getByText("14:03:00")).toBeInTheDocument();
  });

  test("critical is announced assertively, others politely", () => {
    const { rerender } = r(<MarketAlertCard alert={alert({ severity: "critical" })} />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    rerender(<MarketAlertCard alert={alert({ severity: "watch" })} />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
  });

  test("metrics with no entries are omitted", () => {
    r(<MarketAlertCard alert={alert({ metrics: [] })} />);
    expect(screen.queryByText("ΔOI")).not.toBeInTheDocument();
  });
});

describe("MarketAlertStack", () => {
  test("empty list renders nothing", () => {
    const { container } = r(<MarketAlertStack alerts={[]} />);
    expect(container.querySelector('[data-testid="market-alert-stack"]')).toBeNull();
  });

  test("coalesces the tail into one +N line", () => {
    const alerts = Array.from({ length: 7 }, (_, i) =>
      alert({ id: `a${i}`, ts: alert().ts - i * 1000 }),
    );
    r(<MarketAlertStack alerts={alerts} max={3} />);
    const stack = screen.getByTestId("market-alert-stack");
    expect(within(stack).getAllByRole("alert")).toHaveLength(3);
    expect(screen.getByTestId("market-alert-overflow")).toHaveTextContent("+4 more alerts");
  });

  test("no overflow line when the list fits", () => {
    r(<MarketAlertStack alerts={[alert({ id: "a1" }), alert({ id: "a2" })]} max={3} />);
    expect(screen.queryByTestId("market-alert-overflow")).not.toBeInTheDocument();
  });
});

describe("MarketAlertLog", () => {
  const rows = [
    alert({ id: "a1", symbol: "NIFTY", ts: alert().ts }),
    alert({ id: "a2", kind: "price_spike", symbol: "RELIANCE", severity: "critical", ts: alert().ts - 60000 }),
    alert({ id: "a3", kind: "volume_spike", symbol: "TATAMOTORS", severity: "watch", ts: alert().ts - 120000 }),
  ];

  test("renders a sticky header log with one 20px row per alert", () => {
    r(<MarketAlertLog alerts={rows} />);
    const log = screen.getByTestId("market-alert-log");
    expect(within(log).getByTestId("market-alert-log-head")).toHaveTextContent("SYMBOL");
    expect(within(log).getAllByRole("alert")).toHaveLength(3);
    expect(within(log).getByText("3 rows")).toBeInTheDocument();
  });

  test("empty log shows NO ALERTS", () => {
    r(<MarketAlertLog alerts={[]} />);
    expect(screen.getByText("NO ALERTS")).toBeInTheDocument();
  });

  test("first row is active and keyboard moves the selection", () => {
    r(<MarketAlertLog alerts={rows} />);
    const log = screen.getByTestId("market-alert-log");
    const getRows = () => within(log).getAllByRole("alert");
    expect(getRows()[0].getAttribute("data-active")).toBe("1");
    fireEvent.keyDown(log, { key: "ArrowDown" });
    expect(getRows()[1].getAttribute("data-active")).toBe("1");
    expect(getRows()[0].getAttribute("data-active")).toBeNull();
    fireEvent.keyDown(log, { key: "End" });
    expect(getRows()[2].getAttribute("data-active")).toBe("1");
    fireEvent.keyDown(log, { key: "Home" });
    expect(getRows()[0].getAttribute("data-active")).toBe("1");
  });

  test("Enter opens the active row; Escape dismisses it", () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    r(<MarketAlertLog alerts={rows} onOpen={onOpen} onDismiss={onDismiss} />);
    const log = screen.getByTestId("market-alert-log");
    fireEvent.keyDown(log, { key: "ArrowDown" });
    fireEvent.keyDown(log, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a2" }));
    fireEvent.keyDown(log, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledWith("a2");
  });

  test("selection is clamped at the ends", () => {
    r(<MarketAlertLog alerts={rows} />);
    const log = screen.getByTestId("market-alert-log");
    const getRows = () => within(log).getAllByRole("alert");
    fireEvent.keyDown(log, { key: "ArrowUp" });
    expect(getRows()[0].getAttribute("data-active")).toBe("1");
    fireEvent.keyDown(log, { key: "End" });
    fireEvent.keyDown(log, { key: "ArrowDown" });
    expect(getRows()[2].getAttribute("data-active")).toBe("1");
  });
});
