// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
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
