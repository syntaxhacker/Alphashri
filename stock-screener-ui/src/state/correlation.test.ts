// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { CorrelationDataPoint } from "../api/correlation";

vi.mock("../api/correlation", () => ({
  fetchCorrelation: vi.fn(),
}));

vi.mock("./createSubscriber", () => ({
  createSubscriber: () => ({
    subscribe: vi.fn(),
    notify: vi.fn(),
  }),
}));

beforeEach(async () => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("correlation state", () => {
  describe("setSymbols", () => {
    test("sets symbols and calls notify", async () => {
      const { setSymbols, symbols: _symbols, notify } = await import("./correlation");
      setSymbols(["RELIANCE", "TCS"]);
      expect(notify).toHaveBeenCalled();
    });
  });

  describe("addSymbol", () => {
    test("adds a new symbol and calls notify", async () => {
      const { addSymbol, symbols: _symbols, notify } = await import("./correlation");
      const _initialLength = _symbols.length;
      addSymbol("NEW");
      expect(notify).toHaveBeenCalled();
    });

    test("does not add duplicate symbols", async () => {
      const {
        addSymbol,
        symbols: _symbols2,
        notify: _notify,
        setSymbols,
      } = await import("./correlation");
      setSymbols(["RELIANCE"]);
      const _initialLength2 = _symbols2.length;
      addSymbol("RELIANCE");
      expect(_symbols2.length).toBe(_initialLength2);
    });

    test("does not call notify when adding duplicate", async () => {
      const { addSymbol, setSymbols, notify } = await import("./correlation");
      setSymbols(["RELIANCE"]);
      vi.clearAllMocks();
      addSymbol("RELIANCE");
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("removeSymbol", () => {
    test("removes a symbol and calls notify", async () => {
      const {
        removeSymbol,
        setSymbols,
        symbols: _symbols3,
        notify,
      } = await import("./correlation");
      setSymbols(["RELIANCE", "TCS"]);
      vi.clearAllMocks();
      removeSymbol("RELIANCE");
      expect(notify).toHaveBeenCalled();
    });

    test("removing non-existent symbol still calls notify", async () => {
      const { removeSymbol, setSymbols, notify } = await import("./correlation");
      setSymbols(["RELIANCE"]);
      vi.clearAllMocks();
      removeSymbol("NONEXISTENT");
      expect(notify).toHaveBeenCalled();
    });
  });

  describe("setTimeframe", () => {
    test("sets timeframe to intraday and calls notify", async () => {
      const { setTimeframe, notify } = await import("./correlation");
      setTimeframe("intraday");
      expect(notify).toHaveBeenCalled();
    });

    test("sets timeframe to daily and calls notify", async () => {
      const { setTimeframe, notify } = await import("./correlation");
      setTimeframe("daily");
      expect(notify).toHaveBeenCalled();
    });
  });

  describe("setPeriod", () => {
    test("sets period and calls notify", async () => {
      const { setPeriod, notify } = await import("./correlation");
      setPeriod(30);
      expect(notify).toHaveBeenCalled();
    });
  });

  describe("setPeriodUnit", () => {
    test("sets period unit to minutes and calls notify", async () => {
      const { setPeriodUnit, notify } = await import("./correlation");
      setPeriodUnit("minutes");
      expect(notify).toHaveBeenCalled();
    });

    test("sets period unit to days and calls notify", async () => {
      const { setPeriodUnit, notify } = await import("./correlation");
      setPeriodUnit("days");
      expect(notify).toHaveBeenCalled();
    });
  });

  describe("setCorrelationData", () => {
    test("sets matrix, normalized, meta and calls notify", async () => {
      const { setCorrelationData, notify } = await import("./correlation");
      const data = {
        matrix: [
          [1, 0.5],
          [0.5, 1],
        ],
        normalized: {
          RELIANCE: [{ timestamp: "2024-01-01", value: 100 }],
          TCS: [{ timestamp: "2024-01-01", value: 100 }],
        } as Record<string, CorrelationDataPoint[]>,
        meta: { start_date: "2024-01-01", end_date: "2024-01-31", data_points: 20 },
      };
      setCorrelationData(data);
      expect(notify).toHaveBeenCalled();
    });
  });

  describe("setIsLoading", () => {
    test("sets loading state", async () => {
      const mod = await import("./correlation");
      mod.setIsLoading(true);
      expect(mod.isLoading).toBe(true);
    });

    test("calls notify on setIsLoading", async () => {
      const mod = await import("./correlation");
      vi.clearAllMocks();
      mod.setIsLoading(true);
      expect(mod.notify).toHaveBeenCalled();
    });
  });

  describe("setError", () => {
    test("sets error state", async () => {
      const mod = await import("./correlation");
      mod.setError("Something went wrong");
      expect(mod.error).toBe("Something went wrong");
    });

    test("clears error when passed null", async () => {
      const mod = await import("./correlation");
      mod.setError("error");
      mod.setError(null);
      expect(mod.error).toBeNull();
    });

    test("calls notify on setError", async () => {
      const mod = await import("./correlation");
      vi.clearAllMocks();
      mod.setError("test error");
      expect(mod.notify).toHaveBeenCalled();
    });
  });

  describe("fetchCorrelationData", () => {
    test("calls fetchCorrelation and sets data on success", async () => {
      const { fetchCorrelation } = await import("../api/correlation");
      vi.mocked(fetchCorrelation).mockResolvedValue({
        matrix: [
          [1, 0.5],
          [0.5, 1],
        ],
        symbols: ["RELIANCE", "TCS"],
        normalized: {
          RELIANCE: [{ timestamp: "2024-01-01", value: 100 }],
          TCS: [{ timestamp: "2024-01-01", value: 100 }],
        },
        meta: { start_date: "2024-01-01", end_date: "2024-01-31", data_points: 20 },
      });

      const {
        fetchCorrelationData,
        setSymbols,
        setTimeframe,
        setPeriod,
        setPeriodUnit,
        notify: _notify1,
      } = await import("./correlation");

      setSymbols(["RELIANCE", "TCS"]);
      setTimeframe("daily");
      setPeriod(30);
      setPeriodUnit("days");
      vi.clearAllMocks();

      await fetchCorrelationData();

      expect(fetchCorrelation).toHaveBeenCalledWith({
        symbols: ["RELIANCE", "TCS"],
        timeframe: "daily",
        period: 30,
        period_unit: "days",
      });
    });

    test("sets error on failure", async () => {
      const { fetchCorrelation } = await import("../api/correlation");
      vi.mocked(fetchCorrelation).mockRejectedValue(new Error("Network error"));

      const {
        fetchCorrelationData,
        setSymbols,
        setTimeframe,
        setPeriod,
        setPeriodUnit,
        notify: _notify2,
      } = await import("./correlation");

      setSymbols(["RELIANCE"]);
      setTimeframe("daily");
      setPeriod(30);
      setPeriodUnit("days");
      vi.clearAllMocks();

      await fetchCorrelationData();

      expect(_notify2).toHaveBeenCalled();
    });

    test("sets loading state during fetch", async () => {
      const { fetchCorrelation } = await import("../api/correlation");
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(fetchCorrelation).mockReturnValue(promise as any);

      const {
        fetchCorrelationData,
        setSymbols,
        setTimeframe,
        setPeriod,
        setPeriodUnit,
        notify: _notify3,
      } = await import("./correlation");

      setSymbols(["RELIANCE"]);
      setTimeframe("daily");
      setPeriod(30);
      setPeriodUnit("days");
      vi.clearAllMocks();

      const fetchPromise = fetchCorrelationData();

      expect(_notify3).toHaveBeenCalled();

      resolvePromise!({
        matrix: [[1]],
        symbols: ["RELIANCE"],
        normalized: { RELIANCE: [] },
        meta: { start_date: "2024-01-01", end_date: "2024-01-31", data_points: 1 },
      });
      await fetchPromise;
    });
  });
});
