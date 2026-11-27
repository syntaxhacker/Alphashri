// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { MarketFilterRail } from "./MarketFilterRail";
import { defaultMarketFilters, type MarketFilterState } from "./marketFilters";

afterEach(cleanup);

describe("MarketFilterRail sma200 switch", () => {
  test("clicking the switch emits an aboveSma200 patch", async () => {
    const changes: Array<Partial<MarketFilterState>> = [];
    render(() => (
      <MarketFilterRail
        filters={defaultMarketFilters()}
        onChange={(patch) => changes.push(patch)}
        sectors={["IT"]}
      />
    ));

    await fireEvent.click(screen.getByTestId("market-filter-above-sma200"));

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ aboveSma200: true });
  });
});
