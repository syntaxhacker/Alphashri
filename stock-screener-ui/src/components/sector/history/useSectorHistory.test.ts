// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { createEffect, createSignal } from "solid-js";
import type { SectorHistoryMarket, SectorHistoryResponse } from "../../../types/sectorHistory";
import { useSectorHistory } from "./useSectorHistory";

interface Params {
  market: SectorHistoryMarket;
  years: number;
  signal?: AbortSignal;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function response(market: SectorHistoryMarket, asOf: string): SectorHistoryResponse {
  return {
    market,
    years: 5,
    cached: false,
    months: ["2026-01", "2026-02"],
    as_of: asOf,
    last_updated: "2026-03-01T00:00:00Z",
    source: "fixture",
    disclaimer: "",
    universe: ["Technology"],
    series: [
      { name: "Technology", is_benchmark: false, monthly_returns: [1, 2], ranks: [1, 1] },
      { name: "Benchmark", is_benchmark: true, monthly_returns: [0, 0], ranks: [null, null] },
    ],
    risk: [
      {
        name: "Technology",
        max_drawdown: -5,
        current_drawdown: 0,
        recovery_days: 10,
        sharpe: 1,
        volatility: 12,
      },
    ],
    seasonality: [{ name: "Technology", month: 1, avg_return: 1, hit_rate: 0.5, n: 2 }],
    persistence: { by_sector: [], transition_matrix: [[0.6, 0.4]] },
  };
}

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("../../../api/sectorHistory", () => ({
  fetchSectorHistory: (...args: unknown[]) => fetchMock(...args),
}));

function Probe(props: { market: () => SectorHistoryMarket; years: () => number }) {
  const { data, loading, error } = useSectorHistory(props.market, props.years);
  const root = document.createElement("div");
  const market = document.createElement("span");
  const asOf = document.createElement("span");
  const loadingEl = document.createElement("span");
  const errorEl = document.createElement("span");
  market.dataset.testid = "market";
  asOf.dataset.testid = "as-of";
  loadingEl.dataset.testid = "loading";
  errorEl.dataset.testid = "error";
  createEffect(() => {
    market.textContent = data()?.market ?? "none";
    asOf.textContent = data()?.as_of ?? "none";
    loadingEl.textContent = loading() ? "yes" : "no";
    errorEl.textContent = error() ?? "";
  });
  root.append(market, asOf, loadingEl, errorEl);
  return root;
}

function trackRequests() {
  const requests: Array<{ params: Params; deferred: Deferred<SectorHistoryResponse> }> = [];
  fetchMock.mockImplementation((params: Params) => {
    const pending = deferred<SectorHistoryResponse>();
    requests.push({ params, deferred: pending });
    return pending.promise;
  });
  return requests;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useSectorHistory stale responses", () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  test("keeps US data when the aborted India request resolves late", async () => {
    const requests = trackRequests();
    const [market, setMarket] = createSignal<SectorHistoryMarket>("india");
    render(() => Probe({ market, years: () => 5 }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].params).toMatchObject({ market: "india", years: 5 });
    setMarket("america");
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].params.signal?.aborted).toBe(true);

    requests[1].deferred.resolve(response("america", "2026-12-31"));
    await waitFor(() => expect(screen.getByTestId("as-of")).toHaveTextContent("2026-12-31"));

    requests[0].deferred.resolve(response("india", "1999-01-01"));
    await flush();

    expect(screen.getByTestId("as-of")).toHaveTextContent("2026-12-31");
    expect(screen.getByTestId("market")).toHaveTextContent("america");
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  test("ignores a stale rejection without surfacing an error", async () => {
    const requests = trackRequests();
    const [market, setMarket] = createSignal<SectorHistoryMarket>("india");
    render(() => Probe({ market, years: () => 5 }));

    await waitFor(() => expect(requests).toHaveLength(1));
    setMarket("america");
    await waitFor(() => expect(requests).toHaveLength(2));
    requests[1].deferred.resolve(response("america", "2026-12-31"));
    await waitFor(() => expect(screen.getByTestId("as-of")).toHaveTextContent("2026-12-31"));

    requests[0].deferred.reject(new Error("sector_history_unavailable"));
    await flush();

    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
    expect(screen.getByTestId("as-of")).toHaveTextContent("2026-12-31");
  });

  test("aborts the in-flight request on unmount", async () => {
    const requests = trackRequests();
    const { unmount } = render(() => Probe({ market: () => "india", years: () => 5 }));
    await waitFor(() => expect(requests).toHaveLength(1));

    const signal = requests[0].params.signal;
    unmount();
    expect(signal?.aborted).toBe(true);

    requests[0].deferred.resolve(response("india", "1999-01-01"));
    await flush();
  });
});
