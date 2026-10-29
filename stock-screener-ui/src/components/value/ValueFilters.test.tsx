// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { ValueFilters } from "./ValueFilters";
import type { ValueFilters as ValueFilterState } from "../../api/valueScan";

function r(jsx: React.ReactElement) {
  return render(<UIProvider>{jsx}</UIProvider>);
}

afterEach(cleanup);

describe("ValueFilters", () => {
  test("changing a numeric filter calls onChange with the numeric value", () => {
    const onChange = vi.fn();
    r(<ValueFilters filters={{}} onChange={onChange} />);
    const input = screen.getByTestId("value-filter-max-pe").querySelector("input");
    expect(input).toBeInTheDocument();
    fireEvent.change(input as HTMLInputElement, { target: { value: "15" } });
    expect(onChange).toHaveBeenCalledWith({ max_pe: 15 });
  });

  test("min ROE and FCF yield filters emit numbers", () => {
    const onChange = vi.fn();
    r(<ValueFilters filters={{}} onChange={onChange} />);
    fireEvent.change(
      screen.getByTestId("value-filter-min-roe").querySelector("input") as HTMLInputElement,
      { target: { value: "12" } },
    );
    expect(onChange).toHaveBeenCalledWith({ min_roe: 12 });
    fireEvent.change(
      screen.getByTestId("value-filter-min-fcf").querySelector("input") as HTMLInputElement,
      { target: { value: "4.5" } },
    );
    expect(onChange).toHaveBeenCalledWith({ min_fcf_yield: 4.5 });
  });

  test("the switch toggles above_200dma", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    r(<ValueFilters filters={{ above_200dma: false }} onChange={onChange} />);
    const input = screen.getByTestId("value-filter-above-200dma");
    expect(input).toBeInTheDocument();
    await user.click(input);
    expect(onChange).toHaveBeenCalledWith({ above_200dma: true });
  });

  test("sort and limit selects emit values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    r(<ValueFilters filters={{ sort: "score_desc", limit: 100 }} onChange={onChange} />);
    await user.click(
      screen.getByTestId("value-filter-sort").querySelector('[role="combobox"]') as HTMLElement,
    );
    await user.click(await screen.findByRole("option", { name: "P/E ↑" }));
    expect(onChange).toHaveBeenCalledWith({ sort: "pe_asc" });

    await user.click(
      screen.getByTestId("value-filter-limit").querySelector('[role="combobox"]') as HTMLElement,
    );
    await user.click(await screen.findByRole("option", { name: "200" }));
    expect(onChange).toHaveBeenCalledWith({ limit: 200 });
  });

  test("more-filters drawer opens and exposes the remaining filters", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const filters: ValueFilterState = {};
    r(<ValueFilters filters={filters} onChange={onChange} />);
    expect(screen.queryByTestId("value-more-filters-modal")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("value-more-filters"));
    expect(screen.getByTestId("value-more-filters-modal")).toBeInTheDocument();
    fireEvent.change(
      screen.getByTestId("value-more-max-pb").querySelector("input") as HTMLInputElement,
      { target: { value: "1.5" } },
    );
    expect(onChange).toHaveBeenCalledWith({ max_pb: 1.5 });
    await user.click(screen.getByTestId("value-more-require-low-de"));
    expect(onChange).toHaveBeenCalledWith({ require_low_de: true });
  });
});
