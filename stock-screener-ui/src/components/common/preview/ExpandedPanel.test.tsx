// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import type { ChartPreviewData } from "../../../api/chartPreview";
import { OR_MINUTES_OPTIONS, TIMEFRAMES } from "../../../config/constants";
import type { ChartInstanceBox } from "./types";
import { ExpandedPanel } from "./ExpandedPanel";

const h = vi.hoisted(() => {
  const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { init: vi.fn(() => instance), instance };
});

vi.mock("@/utils/loadEcharts", () => ({ loadEcharts: vi.fn(async () => h) }));

const candle = {
  time: "2025-10-24T09:15",
  date: "2025-10-24",
  time_str: "09:15",
  open: 100,
  high: 105,
  low: 98,
  close: 103,
  volume: 1000,
};

const data: ChartPreviewData = {
  symbol: "RELIANCE",
  candles: [candle],
  orb_zones: [],
  pivot_levels: [],
  timeframe: 15,
  total_candles: 1,
};

type Props = Parameters<typeof ExpandedPanel>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    symbol: "RELIANCE",
    data,
    loading: false,
    error: null,
    timeframe: 15,
    orMinutes: 45,
    chartBox: { current: null } as ChartInstanceBox,
    onTimeframeChange: vi.fn(),
    onOrMinutesChange: vi.fn(),
    onClose: vi.fn(),
    onOpenFull: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExpandedPanel", () => {
  test("renders a labelled dialog shell with the symbol, candle count and both chart controls", () => {
    renderWithProviders(() => <ExpandedPanel {...props()} />);

    const panel = screen.getByTestId("preview-chart-expanded");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAttribute("aria-label", "RELIANCE preview chart");
    expect(panel).toHaveTextContent("RELIANCE (1 candles)");

    const tf = screen.getByTestId("preview-tf-select").querySelector("select") as HTMLSelectElement;
    const or = screen.getByTestId("preview-or-select").querySelector("select") as HTMLSelectElement;
    expect(Array.from(tf.options).map((o) => o.value)).toEqual(TIMEFRAMES.map((t) => String(t.value)));
    expect(Array.from(or.options).map((o) => o.value)).toEqual(OR_MINUTES_OPTIONS.map((o) => String(o.value)));
    expect(tf.value).toBe("15");
    expect(or.value).toBe("45");
    expect(screen.getByTestId("preview-close-btn")).toBeInTheDocument();
    expect(screen.getByTestId("preview-open-full-link")).toHaveTextContent("Open Full Chart");
    expect(screen.getByTestId("preview-open-full-btn")).toBeInTheDocument();
  });

  test("names the close control, both selects and the icon-only full-chart button", () => {
    renderWithProviders(() => <ExpandedPanel {...props()} />);

    const tf = screen.getByTestId("preview-tf-select").querySelector("select") as HTMLSelectElement;
    const or = screen.getByTestId("preview-or-select").querySelector("select") as HTMLSelectElement;
    expect(tf).toHaveAttribute("aria-label", "Chart timeframe");
    expect(or).toHaveAttribute("aria-label", "Opening range in minutes");
    expect(screen.getByTestId("preview-close-btn")).toHaveAttribute("aria-label", "close");
    expect(screen.getByTestId("preview-open-full-btn")).toHaveAttribute("aria-label", "Open full chart");

    expect(screen.getByRole("combobox", { name: "Chart timeframe" })).toBe(tf);
    expect(screen.getByRole("combobox", { name: "Opening range in minutes" })).toBe(or);
    expect(screen.getByRole("button", { name: "close" })).toBe(screen.getByTestId("preview-close-btn"));
    expect(screen.getByRole("button", { name: "Open full chart" })).toBe(screen.getByTestId("preview-open-full-btn"));
  });

  test("axe: the expanded dialog has no unlabeled button or select", async () => {
    const view = renderWithProviders(() => <ExpandedPanel {...props({ error: "Upstream down" })} />);
    const result = await axe.run(view.container, {
      runOnly: { type: "rule", values: ["button-name", "select-name"] },
    });
    const executed = [...result.passes, ...result.violations, ...result.incomplete].map((check) => check.id);
    expect(executed).toContain("button-name");
    expect(executed).toContain("select-name");
    expect(result.violations).toEqual([]);
  });

  test("forwards timeframe, OR-window, full-chart and retry actions to the host", () => {
    const p = props({ error: "Upstream down" });
    renderWithProviders(() => <ExpandedPanel {...p} />);

    fireEvent.input(screen.getByTestId("preview-tf-select").querySelector("select")!, {
      target: { value: "30" },
    });
    expect(p.onTimeframeChange).toHaveBeenCalledWith("30");
    fireEvent.input(screen.getByTestId("preview-or-select").querySelector("select")!, {
      target: { value: "60" },
    });
    expect(p.onOrMinutesChange).toHaveBeenCalledWith("60");

    fireEvent.click(screen.getByTestId("preview-open-full-btn"));
    fireEvent.click(screen.getByTestId("preview-open-full-link"));
    expect(p.onOpenFull).toHaveBeenCalledTimes(2);
    expect(p.onOpenFull).toHaveBeenCalledWith("RELIANCE");

    fireEvent.click(screen.getByTestId("preview-chart-retry"));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  test("shows loading, error and truly-empty states without mounting a chart", () => {
    const loading = renderWithProviders(() => <ExpandedPanel {...props({ loading: true })} />);
    expect(document.querySelector('[data-testid="preview-chart-expanded"] .echarts-container')).toBeNull();
    expect(h.init).not.toHaveBeenCalled();
    loading.unmount();

    const failed = renderWithProviders(() =>
      <ExpandedPanel {...props({ error: "HTTP 500" })} />,
    );
    const errorBox = screen.getByTestId("preview-chart-expanded-error");
    expect(errorBox).toHaveTextContent("Couldn't load chart");
    expect(errorBox).toHaveTextContent("HTTP 500");
    expect(screen.getByTestId("preview-chart-retry")).toBeInTheDocument();
    expect(h.init).not.toHaveBeenCalled();
    failed.unmount();

    renderWithProviders(() => <ExpandedPanel {...props({ data: null })} />);
    expect(screen.getByTestId("preview-chart-expanded-empty")).toHaveTextContent("No data available");
    expect(screen.queryByTestId("preview-chart-expanded-error")).not.toBeInTheDocument();
    expect(h.init).not.toHaveBeenCalled();
  });

  test("mounts the chart into the expanded container and disposes it on unmount", async () => {
    const chartBox = { current: null } as ChartInstanceBox;
    const view = renderWithProviders(() => <ExpandedPanel {...props({ chartBox })} />);

    await vi.waitFor(() => expect(h.init).toHaveBeenCalledTimes(1));
    const container = document.querySelector(
      '[data-testid="preview-chart-expanded"] .echarts-container',
    ) as HTMLElement;
    expect(container).not.toBeNull();
    expect(h.init).toHaveBeenCalledWith(container);
    expect(h.instance.setOption).toHaveBeenCalledTimes(1);
    expect(h.instance.resize).toHaveBeenCalledTimes(1);
    expect(chartBox.current).toBe(h.instance);

    window.dispatchEvent(new Event("resize"));
    expect(h.instance.resize).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(h.instance.dispose).toHaveBeenCalledTimes(1);
    expect(chartBox.current).toBeNull();
  });

  test("dismisses via the close button, Escape and a backdrop click", () => {
    const p = props();
    renderWithProviders(() => <ExpandedPanel {...p} />);

    fireEvent.click(screen.getByTestId("preview-close-btn"));
    expect(p.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("preview-chart-expanded"));
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });
});
