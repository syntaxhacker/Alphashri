// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { UIProvider } from "@/ui";
import {
  ALERT_KIND_CODE,
  ALERT_KIND_LABEL,
  ALERT_SEVERITY,
  MarketAlertCard,
  MarketAlertLog,
  MarketAlertRow,
  MarketAlertStack,
  logFixedWidth,
  logLayoutFits,
  logLayoutFor,
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

function r(jsx: JSX.Element) {
  return render(() => <UIProvider>{jsx}</UIProvider>);
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

  test("detail lives in the tooltip", () => {
    r(<MarketAlertRow alert={alert()} />);
    const row = screen.getByTestId("market-alert-oi_burst");
    expect(row).toHaveAttribute("title", expect.stringContaining("+170.16M added in 3 min"));
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

  test("a payload href becomes a real link that does not trigger row onOpen", () => {
    const onOpen = vi.fn();
    r(<MarketAlertRow alert={alert({ href: "/report/index" })} onOpen={onOpen} />);
    const link = screen.getByTestId("market-alert-link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/report/index");
    expect(link.className).toContain("focus-visible:outline-2");
    fireEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("canonical alert symbols", () => {
  test("row and card render displaySymbol while the alert payload keeps the raw symbol", () => {
    const prefixed = alert({ symbol: "NSE:RELIANCE" });
    const onOpen = vi.fn();
    r(
      <>
        <MarketAlertRow alert={prefixed} onOpen={onOpen} />
        <MarketAlertCard alert={prefixed} />
      </>,
    );
    const rows = screen.getAllByTestId("market-alert-oi_burst");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveTextContent("RELIANCE");
      expect(row).not.toHaveTextContent("NSE:");
      expect(row.getAttribute("title") ?? "").not.toContain("NSE:");
      expect(row.getAttribute("aria-label") ?? "").not.toContain("NSE:");
    }
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ symbol: "NSE:RELIANCE" }));
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
    const [severity, setSeverity] = createSignal<"critical" | "watch">("critical");
    r(<MarketAlertCard alert={alert({ severity: severity() })} />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    setSeverity("watch");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
  });

  test("metrics with no entries are omitted", () => {
    r(<MarketAlertCard alert={alert({ metrics: [] })} />);
    expect(screen.queryByText("ΔOI")).not.toBeInTheDocument();
  });

  test("a payload href renders a real focusable link and does not fire onOpen", () => {
    const onOpen = vi.fn();
    r(<MarketAlertCard alert={alert({ href: "/report/index" })} onOpen={onOpen} />);

    const link = screen.getByTestId("market-alert-link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/report/index");
    expect(link).toHaveAccessibleName("Open NIFTY — Call ΔOI burst — 22,600 CE");
    expect(link.className).toContain("focus-visible:outline-2");

    fireEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("an alert without href renders no link and stays non-interactive", () => {
    r(<MarketAlertCard alert={alert()} />);
    expect(screen.queryByTestId("market-alert-link")).toBeNull();
    expect(screen.getByTestId("market-alert-oi_burst")).not.toHaveAttribute("tabindex");
  });

  test("a clickable alert without href opens on Enter and Space", () => {
    const onOpen = vi.fn();
    r(<MarketAlertCard alert={alert()} onOpen={onOpen} />);
    const card = screen.getByTestId("market-alert-oi_burst");
    expect(card).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
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

/**
 * Geometry regression (defect 3): the old fixed 232px FACTS column forced the
 * HEADLINE flex child to 0px at 390, hiding the alert type with no scroll cue.
 * happy-dom has no layout engine, so the flex arithmetic is asserted both as a
 * pure contract (the same constants the component renders) and as DOM styles.
 */
describe("MarketAlertLog geometry at narrow viewports", () => {
  const atWidth = (width: number, fn: () => void) => {
    const original = window.innerWidth;
    window.innerWidth = width;
    try {
      window.dispatchEvent(new Event("resize"));
      fn();
    } finally {
      window.innerWidth = original;
      window.dispatchEvent(new Event("resize"));
    }
  };

  test("390 layout fits with HEADLINE > 0 and no column overlap", () => {
    const l = logLayoutFor(390);
    expect(l.kind).toBe(0);
    expect(l.headlineMin).toBeGreaterThan(0);
    for (const col of ["sev", "symbol", "facts", "ist", "dismiss"] as const) {
      expect(l[col], `${col} collapsed`).toBeGreaterThan(0);
    }
    expect(logLayoutFits(390, l)).toBe(true);
    let cursor = 2;
    for (const col of [l.sev, l.symbol, l.headlineMin, l.facts, l.ist, l.dismiss]) {
      expect(cursor + col).toBeLessThanOrEqual(390);
      cursor += col + 4;
    }
  });

  test("1600 layout keeps the original wide columns", () => {
    const wide = logLayoutFor(1600);
    expect(wide).toEqual({
      kind: 34,
      sev: 70,
      symbol: 92,
      facts: 232,
      ist: 34,
      dismiss: 18,
      headlineMin: 0,
    });
    expect(logFixedWidth(wide)).toBe(516);
    expect(logLayoutFits(1600, wide)).toBe(true);
  });

  test("DOM at 390 renders a visible TYPE/HEADLINE, with SEV/SYMBOL/FACTS/IST intact", () => {
    atWidth(390, () => {
      r(<MarketAlertLog alerts={[alert()]} fill={false} height={120} />);
      const log = screen.getByTestId("market-alert-log");
      const head = within(log).getByTestId("market-alert-log-head");
      const headHeadline = within(log).getByTestId("market-alert-log-headline");
      const rowHeadline = within(log).getByTestId("market-alert-row-headline");
      expect(headHeadline.style.minWidth).toBe("48px");
      expect(rowHeadline.style.minWidth).toBe("48px");
      expect(rowHeadline).toHaveTextContent("OI · Call ΔOI burst");
      expect(head.querySelector('[data-col="kind"]')).toHaveStyle("display: none");
      for (const col of ["sev", "symbol", "facts", "ist"]) {
        expect(head.querySelector(`[data-col="${col}"]`), `${col} missing`).not.toBeNull();
      }
      expect(screen.queryByTestId("market-alert-log-scroll-cue")).toBeNull();
      expect(log).toHaveAttribute("tabindex", "0");
      fireEvent.keyDown(log, { key: "ArrowDown" });
      expect(within(log).getAllByRole("alert")[0].getAttribute("data-active")).toBe("1");
    });
  });

  test("an unfit width shows a reachable horizontal-scroll cue", () => {
    atWidth(280, () => {
      r(<MarketAlertLog alerts={[alert()]} fill={false} height={120} />);
      expect(screen.getByTestId("market-alert-log-scroll-cue")).toHaveTextContent("SCROLL");
      expect(screen.getByTestId("market-alert-log-scroll")).toHaveAttribute("tabindex", "0");
    });
  });
});
