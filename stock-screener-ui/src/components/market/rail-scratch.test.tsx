// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { MarketFilterRail } from "./MarketFilterRail";
import { defaultMarketFilters, type MarketFilterState } from "./marketFilters";

afterEach(cleanup);

describe("rail probe", () => {
  test("sma200 switch toggles and calls onChange", async () => {
    const [filters, setFilters] = createSignal<MarketFilterState>(defaultMarketFilters());
    const onChange = (patch: Partial<MarketFilterState>) => {
      console.log("ONCHANGE PATCH:", JSON.stringify(patch));
      setFilters((f) => ({ ...f, ...patch }));
    };
    render(() => (
      <MarketFilterRail
        filters={filters()}
        onChange={onChange}
        sectors={["IT"]}
        tierCounts={{}}
      />
    ));
    const sw = screen.getByTestId("market-filter-above-sma200");
    console.log("SW HTML:", sw.outerHTML.slice(0, 200));
    await fireEvent.click(sw);
    console.log("ABOVE_SMA200 AFTER:", JSON.stringify(filters().aboveSma200));
    expect(filters().aboveSma200).toBe(true);
  });
});
