// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { createSignal } from "solid-js";
import type { ValueRow } from "../../api/valueScan";
import { ValueDetailDrawer } from "./ValueDetailDrawer";

afterEach(cleanup);

function row(overrides: Partial<ValueRow> = {}): ValueRow {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    exchange: "NSE",
    currency: "INR",
    price: 1400,
    change: 0.8,
    mcap_bn: 18000,
    rev_bn: 9000,
    pe: 22.4,
    ps: 1.9,
    pb: 2.1,
    fcf_yield: 3.2,
    div_yield: 0.4,
    roe: 9.8,
    gross_margin: 32,
    op_margin: 14,
    rev_yoy: 8,
    eps_yoy: 6,
    debt_to_equity: 0.4,
    current_ratio: 1.2,
    rsi: 48,
    vs_200dma: 1.5,
    off_52w_high: -14,
    score: 81,
    subscores: { value: 21, quality: 20, growth: 18, health: 22 },
    peer: { bucket: "Energy", pe_median: 19.4, roe_median: 11.2, fcf_yield_median: 4.1 },
    flags: ["LOW_PE"],
    derived: {
      fcf_yield: 3.2,
      earnings_yield: 4.5,
      vs_200dma: 1.5,
      off_52w_high: -14,
      distorted_pe: false,
    },
    ...overrides,
  };
}

describe("ValueDetailDrawer dismissal (real @/ui)", () => {
  test("closes via the × in the title bar", async () => {
    const onClose = vi.fn();
    render(() => (
      <UIProvider>
        <ValueDetailDrawer row={row()} onClose={onClose} />
      </UIProvider>
    ));

    expect(screen.getByTestId("value-detail-drawer")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("value-detail-drawer-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closes via Escape", () => {
    const onClose = vi.fn();
    render(() => (
      <UIProvider>
        <ValueDetailDrawer row={row()} onClose={onClose} />
      </UIProvider>
    ));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closes via a backdrop click", async () => {
    const onClose = vi.fn();
    render(() => (
      <UIProvider>
        <ValueDetailDrawer row={row()} onClose={onClose} />
      </UIProvider>
    ));

    await fireEvent.click(screen.getByTestId("value-detail-drawer"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("× is present as soon as a row mounts and disappears with the row", () => {
    const [selected, setSelected] = createSignal<ValueRow | null>(row());
    render(() => (
      <UIProvider>
        <ValueDetailDrawer row={selected()} onClose={() => setSelected(null)} />
      </UIProvider>
    ));

    expect(screen.getByTestId("value-detail-drawer-close")).toBeInTheDocument();
    setSelected(null);
    expect(screen.queryByTestId("value-detail-drawer")).not.toBeInTheDocument();
  });

  test("a click inside the drawer body does not close it", async () => {
    const onClose = vi.fn();
    render(() => (
      <UIProvider>
        <ValueDetailDrawer row={row()} onClose={onClose} />
      </UIProvider>
    ));

    await fireEvent.click(screen.getByTestId("value-detail-RELIANCE"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ValueDetailDrawer subscore bars", () => {
  test("maps the 0–25 range to the full bar width and clamps malformed values", () => {
    render(() => (
      <UIProvider>
        <ValueDetailDrawer
          row={row({
            subscores: {
              value: 25,
              quality: 0,
              growth: 12.5,
              health: Number.NaN,
            },
          })}
          onClose={vi.fn()}
        />
      </UIProvider>
    ));

    const width = (key: string): string =>
      (screen.getByTestId(`value-detail-sub-bar-RELIANCE-${key}`) as HTMLElement).style.width;
    expect(width("value")).toBe("100%");
    expect(width("quality")).toBe("0%");
    expect(width("growth")).toBe("50%");
    expect(width("health")).toBe("0%");
  });

  test("non-finite score, subscores and peer medians never print NaN", () => {
    render(() => (
      <UIProvider>
        <ValueDetailDrawer
          row={row({
            score: Number.NaN,
            subscores: { value: Number.NaN, quality: 1, growth: 2, health: 3 },
            pe: Number.NaN,
            peer: { bucket: "Energy", pe_median: Number.NaN, roe_median: 11, fcf_yield_median: 4 },
            flags: ["LOW_PE"],
          })}
          onClose={vi.fn()}
        />
      </UIProvider>
    ));

    expect(screen.getByText(/Score breakdown/)).toHaveTextContent("n/a");
    expect(screen.getByTestId("value-detail-sub-RELIANCE-value")).toHaveTextContent("n/a");
    expect(document.body.textContent).not.toContain("NaN");
  });
});
