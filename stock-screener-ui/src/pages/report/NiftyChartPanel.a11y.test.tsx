// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";

const env = vi.hoisted(() => ({ mobile: false }));

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: () => <div data-testid="tradingview-chart" />,
}));
vi.mock("@/hooks/useFyersTickStream", () => ({
  useFyersTickStream: () => ({
    isLive: () => false,
    isReconnecting: () => false,
    isMarketClosed: () => false,
    isDisconnected: () => false,
    lastTick: () => null,
  }),
}));
vi.mock("@/api/chartPatterns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chartPatterns")>();
  return {
    ...actual,
    detectPatterns: vi.fn(async () => ({
      hits: [
        {
          pattern_id: "double-bottom",
          pattern_name: "Double bottom",
          direction: "bullish",
          status: "confirmed",
          breakout_level: 25_650,
          target: 25_800,
          stop: 25_500,
          confidence: 80,
          bars_ago: 0,
        },
      ],
    })),
  };
});

const { NiftyChartPanel: Panel } = await import("./NiftyChartPanel");

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-width: 600px") ? env.mobile : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  env.mobile = false;
  window.localStorage.clear();
});

const report = {
  mode: "live",
  date: "2026-10-12",
  expiry: "weekly",
  spot: 25_750,
  ohlc: { open: 25_600, high: 25_800, low: 25_550, close: 25_750 },
  pcrOi: 1.1,
  pcrVol: 0.9,
  maxPain: 25_700,
  strikes: [],
  walls: null,
  gex: null,
  candles: [
    { time: "2026-10-12T09:15:00", open: 25_600, high: 25_650, low: 25_580, close: 25_620 },
    { time: "2026-10-12T09:16:00", open: 25_620, high: 25_680, low: 25_600, close: 25_640 },
  ],
} as any;

function mount() {
  return render(() => (
    <UIProvider>
      <Panel report={report} mode="live" view="chart" />
    </UIProvider>
  ));
}

async function readyDrawToggle() {
  mount();
  const source = screen.getByTestId("nifty-chart-source");
  const labels = Array.from(source.querySelectorAll("button"));
  fireEvent.click(labels.find((b) => b.textContent === "PATTERNS")!);
  await waitFor(() => expect(screen.getByTestId("nifty-patterns-scan")).toBeTruthy());
  fireEvent.click(screen.getByTestId("nifty-patterns-scan"));
  await waitFor(() =>
    expect(screen.getByTestId("nifty-patterns-strip")).toHaveAttribute("data-status", "ready"),
  );
  return () => screen.getByTestId("nifty-patterns-draw");
}

describe("NiftyChartPanel — pattern DRAW toggle keyboard parity", () => {
  test("DRAW OFF is focusable and Enter/Space toggle it without breaking click or aria-pressed", async () => {
    const draw = await readyDrawToggle();
    expect(draw()).toHaveTextContent("DRAW ON");
    expect(draw()).toHaveAttribute("tabindex", "0");
    expect(draw()).toHaveAttribute("aria-pressed", "true");

    // Click still toggles to the keyboard-dead state from the original bug.
    fireEvent.click(draw());
    expect(draw()).toHaveTextContent("DRAW OFF");
    expect(draw()).toHaveAttribute("data-on", "0");
    expect(draw()).toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(draw(), { key: "Enter" });
    expect(draw()).toHaveTextContent("DRAW ON");
    expect(draw()).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(draw(), { key: " " });
    expect(draw()).toHaveTextContent("DRAW OFF");
    expect(draw()).toHaveAttribute("aria-pressed", "false");

    // Unrelated keys must not toggle the overlay.
    fireEvent.keyDown(draw(), { key: "Escape" });
    expect(draw()).toHaveTextContent("DRAW OFF");
  });
});

describe("NiftyChartPanel — MORE aria-controls target exists", () => {
  test("mobile MORE drops aria-controls while its region is unmounted and restores it when open", () => {
    env.mobile = true;
    mount();
    const more = screen.getByTestId("nifty-chart-controls-more");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).not.toHaveAttribute("aria-controls");
    expect(document.getElementById("nifty-chart-controls-extra")).toBeNull();

    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const id = more.getAttribute("aria-controls");
    expect(id).toBe("nifty-chart-controls-extra");
    expect(document.getElementById(id!)).toBe(screen.getByTestId("nifty-chart-controls-extra"));
  });

  test("desktop MORE always names a mounted region, collapsed or expanded", () => {
    mount();
    const more = screen.getByTestId("nifty-chart-controls-more-desktop");
    const id = more.getAttribute("aria-controls");
    expect(id).toBe("nifty-chart-controls-extra-desktop");
    const extra = document.getElementById(id!);
    expect(extra).toBe(screen.getByTestId("nifty-chart-controls-extra-desktop"));
    expect(extra).toHaveStyle({ display: "none" });

    fireEvent.click(more);
    expect(document.getElementById(id!)).toBe(extra);
    expect(extra).toHaveStyle({ display: "flex" });
  });
});
