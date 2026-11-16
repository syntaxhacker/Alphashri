// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { ValueFilters } from "./ValueFilters";
import type { ValueFilters as ValueFilterState } from "../../api/valueScan";

function r(jsx: JSX.Element) {
  return render(() => (<UIProvider>{jsx}</UIProvider>));
}

afterEach(cleanup);

describe("ValueFilters", () => {
  test("changing a numeric filter calls onChange with the numeric value", () => {
    const onChange = vi.fn();
    r(<ValueFilters filters={{}} onChange={onChange} />);
    const input = screen.getByTestId("value-filter-max-pe").querySelector("input");
    expect(input).toBeInTheDocument();
    fireEvent.input(input as HTMLInputElement, { target: { value: "15" } });
    expect(onChange).toHaveBeenCalledWith({ max_pe: 15 });
  });

  test("min ROE and FCF yield filters emit numbers", () => {
    const onChange = vi.fn();
    r(<ValueFilters filters={{}} onChange={onChange} />);
    fireEvent.input(
      screen.getByTestId("value-filter-min-roe").querySelector("input") as HTMLInputElement,
      { target: { value: "12" } },
    );
    expect(onChange).toHaveBeenCalledWith({ min_roe: 12 });
    fireEvent.input(
      screen.getByTestId("value-filter-min-fcf").querySelector("input") as HTMLInputElement,
      { target: { value: "4.5" } },
    );
    expect(onChange).toHaveBeenCalledWith({ min_fcf_yield: 4.5 });
  });

  test("the switch toggles above_200dma", async () => {
        const onChange = vi.fn();
    r(<ValueFilters filters={{ above_200dma: false }} onChange={onChange} />);
    const input = screen.getByTestId("value-filter-above-200dma");
    expect(input).toBeInTheDocument();
    await fireEvent.click(input);
    expect(onChange).toHaveBeenCalledWith({ above_200dma: true });
  });

  test("sort and limit selects emit values", async () => {
        const onChange = vi.fn();
    r(<ValueFilters filters={{ sort: "score", limit: 100 }} onChange={onChange} />);
    fireEvent.input(
      screen.getByTestId("value-filter-sort").querySelector("select") as HTMLSelectElement,
      { target: { value: "pe" } },
    );
    expect(onChange).toHaveBeenCalledWith({ sort: "pe" });

    fireEvent.input(
      screen.getByTestId("value-filter-limit").querySelector("select") as HTMLSelectElement,
      { target: { value: "200" } },
    );
    expect(onChange).toHaveBeenCalledWith({ limit: 200 });
  });

  test("more-filters controls reflect the applied filters after reopening", async () => {
    const onChange = vi.fn();
    r(
      <ValueFilters
        filters={{ max_pb: 1.5, require_low_de: true }}
        onChange={onChange}
      />,
    );
    await fireEvent.click(screen.getByTestId("value-more-filters"));

    const maxPb = screen.getByTestId("value-more-max-pb").querySelector("input") as HTMLInputElement;
    expect(maxPb.value).toBe("1.5");

    // Switch forwards its testid to the native input, not a wrapper.
    const lowDe = screen.getByTestId("value-more-require-low-de") as HTMLInputElement;
    // A controlled switch must show the gate that the request actually carries.
    expect(lowDe.checked).toBe(true);
  });

  test("every more-filters control renders the applied value", async () => {
    const applied: ValueFilterState = {
      min_pe: 5,
      max_pb: 1.5,
      max_de: 0.8,
      min_rev_yoy: 10,
      min_eps_yoy: 12,
      min_div_yield: 1.2,
      max_rsi: 70,
      min_mcap_bn: 50,
      max_mcap_bn: 5000,
      min_price: 100,
      min_volume: 150000,
      require_low_de: true,
      exclude_negative_fcf: true,
      exclude_negative_eps: true,
      exclude_loss_making: true,
    };
    r(<ValueFilters filters={applied} onChange={() => {}} />);
    await fireEvent.click(screen.getByTestId("value-more-filters"));

    const numberFields: [string, number][] = [
      ["value-more-min-pe", 5],
      ["value-more-max-pb", 1.5],
      ["value-more-max-de", 0.8],
      ["value-more-min-rev-yoy", 10],
      ["value-more-min-eps-yoy", 12],
      ["value-more-min-div-yield", 1.2],
      ["value-more-max-rsi", 70],
      ["value-more-min-mcap", 50],
      ["value-more-max-mcap", 5000],
      ["value-more-min-price", 100],
      ["value-more-min-volume", 150000],
    ];
    for (const [testId, expected] of numberFields) {
      const input = screen.getByTestId(testId).querySelector("input") as HTMLInputElement;
      expect(input.value, testId).toBe(String(expected));
    }

    const switches = [
      "value-more-require-low-de",
      "value-more-exclude-negative-fcf",
      "value-more-exclude-negative-eps",
      "value-more-exclude-loss-making",
    ];
    for (const testId of switches) {
      expect((screen.getByTestId(testId) as HTMLInputElement).checked, testId).toBe(true);
    }
  });

  test("applied values survive closing via the close button and reopening", async () => {
    function Harness() {
      const [filters, setFilters] = createSignal<ValueFilterState>({ max_pb: 1.5, require_low_de: true });
      return (
        <ValueFilters
          filters={filters()}
          onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
        />
      );
    }
    r(<Harness />);

    await fireEvent.click(screen.getByTestId("value-more-filters"));
    const maxPb = () =>
      screen.getByTestId("value-more-max-pb").querySelector("input") as HTMLInputElement;
    fireEvent.input(maxPb(), { target: { value: "0.9" } });
    expect(maxPb().value).toBe("0.9");

    await fireEvent.click(screen.getByTestId("value-more-filters-modal-close"));
    expect(screen.queryByTestId("value-more-filters-modal")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("value-more-filters"));
    expect(maxPb().value).toBe("0.9");
    expect((screen.getByTestId("value-more-require-low-de") as HTMLInputElement).checked).toBe(true);
  });

  test("Escape dismisses the more-filters modal", async () => {
    r(<ValueFilters filters={{ max_pb: 1.5 }} onChange={() => {}} />);
    await fireEvent.click(screen.getByTestId("value-more-filters"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("value-more-filters-modal")).not.toBeInTheDocument();
  });

  test("a backdrop click dismisses the more-filters modal", async () => {
    r(<ValueFilters filters={{ max_pb: 1.5 }} onChange={() => {}} />);
    await fireEvent.click(screen.getByTestId("value-more-filters"));
    await fireEvent.click(screen.getByTestId("value-more-filters-modal"));
    expect(screen.queryByTestId("value-more-filters-modal")).not.toBeInTheDocument();
  });

  test("more-filters drawer opens and exposes the remaining filters", async () => {
        const onChange = vi.fn();
    const filters: ValueFilterState = {};
    r(<ValueFilters filters={filters} onChange={onChange} />);
    expect(screen.queryByTestId("value-more-filters-modal")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("value-more-filters"));
    expect(screen.getByTestId("value-more-filters-modal")).toBeInTheDocument();
    fireEvent.input(
      screen.getByTestId("value-more-max-pb").querySelector("input") as HTMLInputElement,
      { target: { value: "1.5" } },
    );
    expect(onChange).toHaveBeenCalledWith({ max_pb: 1.5 });
    await fireEvent.click(screen.getByTestId("value-more-require-low-de"));
    expect(onChange).toHaveBeenCalledWith({ require_low_de: true });
  });
});
