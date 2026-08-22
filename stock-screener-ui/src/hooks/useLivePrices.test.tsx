// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { useEffect } from "react";

// hoisted mutable state for mocks - allows per-test control without vi.resetModules + dynamic import
const mockState = vi.hoisted(() => ({
  token: "test-jwt-token" as string | null,
  closed: false as boolean,
}));

vi.mock("../state/auth", () => ({
  getAccessToken: () => mockState.token,
}));

vi.mock("../state/holidays", () => ({
  isMarketClosedToday: () => mockState.closed,
}));

// static import - no await import inside tests, no vi.resetModules needed per test
import { useLivePrices } from "./useLivePrices";

function createMockSSEResponse(events: Array<{ event: string; data: string }>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      for (const evt of events) {
        const chunk = `event: ${evt.event}\ndata: ${evt.data}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return {
    ok: true,
    body,
    json: async () => ({}),
  } as unknown as Response;
}

describe("useLivePrices", () => {
  let origAbort: typeof AbortController.prototype.abort;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.token = "test-jwt-token";
    mockState.closed = false;
    global.fetch = vi.fn();
    // save original abort for afterEach restore
    origAbort = AbortController.prototype.abort;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockState.token = "test-jwt-token";
    mockState.closed = false;
    // restore AbortController abort if spied
    if (AbortController.prototype.abort !== origAbort) {
      // vi.spyOn mockRestore
      (AbortController.prototype.abort as any).mockRestore?.();
      AbortController.prototype.abort = origAbort;
    }
    vi.useRealTimers();
  });

  test("connects to SSE endpoint with auth header", async () => {
    const mockResponse = createMockSSEResponse([]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return <div data-testid="lptest" />;
    }

    render(<TestComponent />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/paper/live/stream"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockState.token}`,
          }),
        }),
      );
    });
  });

  test("skips auth header when getAccessToken returns null", async () => {
    mockState.token = null;
    const mockResponse = createMockSSEResponse([]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return <div data-testid="lptest2" />;
    }

    render(<TestComponent />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    const callArgs = (global.fetch as any).mock.calls[0][1];
    expect(callArgs.headers.Authorization).toBeUndefined();
    expect(callArgs.headers.Accept).toBe("text/event-stream");
  });

  test("skips SSE when isMarketClosedToday returns true", async () => {
    mockState.closed = true;
    global.fetch = vi.fn();

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return <div data-testid="closed" />;
    }

    render(<TestComponent />);
    // allow effect to run
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("notifies subscribers on price events", async () => {
    const mockResponse = createMockSSEResponse([
      {
        event: "price",
        data: JSON.stringify({
          type: "price",
          instrument_key: "NSE_EQ|INE002A01018",
          symbol: "RELIANCE",
          ltp: 1417.4,
          ltq: "1",
          ts: "1777449588319",
        }),
      },
      {
        event: "price",
        data: JSON.stringify({
          type: "price",
          instrument_key: "NSE_EQ|INE467B01029",
          symbol: "TCS",
          ltp: 2485.1,
          ltq: "1",
          ts: "1777449586573",
        }),
      },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    const subscriber = vi.fn();

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(subscriber);
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    render(<TestComponent />);

    await waitFor(() => {
      expect(subscriber).toHaveBeenCalledTimes(2);
    });

    const calls = subscriber.mock.calls;
    expect(calls[0][0]).toBe("RELIANCE");
    expect(calls[0][1].ltp).toBe(1417.4);
    expect(calls[1][0]).toBe("TCS");
    expect(calls[1][1].ltp).toBe(2485.1);
  });

  test("skips malformed price missing ltp", async () => {
    const mockResponse = createMockSSEResponse([
      {
        event: "price",
        data: JSON.stringify({
          type: "price",
          instrument_key: "NSE_EQ|INE002A01018",
          symbol: "RELIANCE",
        }),
      },
      {
        event: "price",
        data: JSON.stringify({
          type: "price",
          instrument_key: "NSE_EQ|INE002A01018",
          symbol: "RELIANCE",
          ltp: 100,
        }),
      },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);
    const subscriber = vi.fn();

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(subscriber);
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    render(<TestComponent />);

    await waitFor(() => {
      expect(subscriber).toHaveBeenCalledTimes(1);
    });
    expect(subscriber.mock.calls[0][0]).toBe("RELIANCE");
    expect(subscriber.mock.calls[0][1].ltp).toBe(100);
  });

  test("skips price missing symbol", async () => {
    const mockResponse = createMockSSEResponse([
      {
        event: "price",
        data: JSON.stringify({
          type: "price",
          instrument_key: "NSE_EQ|INE002A01018",
          ltp: 999,
        }),
      },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);
    const subscriber = vi.fn();

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(subscriber);
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    render(<TestComponent />);
    await new Promise((r) => setTimeout(r, 100));
    expect(subscriber).not.toHaveBeenCalled();
  });

  test("deduplicates same ltp - no duplicate notify", async () => {
    const mockResponse = createMockSSEResponse([
      {
        event: "price",
        data: JSON.stringify({ type: "price", symbol: "RELIANCE", ltp: 100, instrument_key: "NSE_EQ|INE002A01018" }),
      },
      {
        event: "price",
        data: JSON.stringify({ type: "price", symbol: "RELIANCE", ltp: 100, instrument_key: "NSE_EQ|INE002A01018" }),
      },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);
    const subscriber = vi.fn();

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(subscriber);
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    render(<TestComponent />);
    await waitFor(() => {
      expect(subscriber).toHaveBeenCalledTimes(1);
    });
  });

  test("handles malformed SSE events gracefully", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode("data: not-json\n\n"));
        controller.enqueue(
          encoder.encode('event: price\ndata: {"type":"price","symbol":"RELIANCE","ltp":100}\n\n'),
        );
        controller.close();
      },
    });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      body,
      json: async () => ({}),
    } as unknown as Response);

    const subscriber = vi.fn();

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(subscriber);
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    render(<TestComponent />);

    await waitFor(() => {
      expect(subscriber).toHaveBeenCalled();
    });

    const lastCall = subscriber.mock.calls[subscriber.mock.calls.length - 1];
    expect(lastCall[0]).toBe("RELIANCE");
    expect(lastCall[1].ltp).toBe(100);
  });

  test("handles error event without crashing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockResponse = createMockSSEResponse([
      {
        event: "error",
        data: JSON.stringify({ message: "Upstox disconnected" }),
      },
      {
        event: "price",
        data: JSON.stringify({ type: "price", symbol: "RELIANCE", ltp: 200, instrument_key: "NSE_EQ|INE002A01018" }),
      },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    const subscriber = vi.fn();

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(subscriber);
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    render(<TestComponent />);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("[LivePrices] Stream error:", "Upstox disconnected");
    });
    // after error event, price still processed (price after error in same stream mock)
    await waitFor(() => {
      expect(subscriber).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });

  test("handles error event with malformed json gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockResponse = createMockSSEResponse([
      { event: "error", data: "not-json" },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    render(<TestComponent />);
    await new Promise((r) => setTimeout(r, 80));
    // should not throw, no error logged for malformed error data
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  test("handles nosymbols event", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const mockResponse = createMockSSEResponse([
      { event: "nosymbols", data: JSON.stringify({ message: "No open positions" }) },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    render(<TestComponent />);
    await waitFor(() => {
      expect(logSpy).toHaveBeenCalledWith("[LivePrices] No symbols to stream");
    });
    logSpy.mockRestore();
  });

  test("handles fetch failure gracefully", async () => {
    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    function TestComponent() {
      const { subscribe, getPrices } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return <div data-testid="lptest" />;
    }

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId("lptest")).toBeInTheDocument();
    });
  });

  test("handles non-ok response gracefully", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      body: null,
    } as unknown as Response);

    function TestComponent() {
      return <div data-testid="oktest" />;
    }
    // need to trigger hook
    function HookComp() {
      useLivePrices();
      return <div data-testid="oktest" />;
    }

    render(<HookComp />);
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[LivePrices] SSE connection failed:", 401);
    });
    warnSpy.mockRestore();
  });

  test("returns empty prices before any events", async () => {
    const mockResponse = createMockSSEResponse([]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    let captured: Record<string, any> = { init: true };
    function TestComponent() {
      const { getPrices } = useLivePrices();
      captured = getPrices();
      return null;
    }

    render(<TestComponent />);
    // getPrices should be empty object initially
    expect(Object.keys(captured)).toHaveLength(0);
  });

  test("cleans up on unmount aborts controller", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const mockResponse = createMockSSEResponse([
      {
        event: "price",
        data: JSON.stringify({ type: "price", symbol: "RELIANCE", ltp: 100, instrument_key: "NSE_EQ|INE002A01018" }),
      },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    const { unmount } = render(<TestComponent />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    unmount();

    await waitFor(() => {
      expect(abortSpy).toHaveBeenCalled();
    });
  });

  test("ignores AbortError on fetch abort", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const abortErr = new DOMException("Aborted", "AbortError");
    (global.fetch as any).mockRejectedValue(abortErr);

    function TestComponent() {
      useLivePrices();
      return null;
    }

    render(<TestComponent />);
    await new Promise((r) => setTimeout(r, 50));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
