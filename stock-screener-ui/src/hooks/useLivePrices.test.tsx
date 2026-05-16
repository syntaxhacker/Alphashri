// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useEffect } from "react";

const mockToken = "test-jwt-token";

vi.mock("../state/auth", () => ({
  getAccessToken: () => mockToken,
}));

vi.mock("../state/holidays", () => ({
  isMarketClosedToday: () => false,
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  test("connects to SSE endpoint with auth header", async () => {
    const mockResponse = createMockSSEResponse([]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    const { useLivePrices } = await import("./useLivePrices");

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return <div data-testid="lptest" />;
    }

    render(<TestComponent />);
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/paper/live/stream"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockToken}`,
          }),
        }),
      );
    });
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

    const { useLivePrices } = await import("./useLivePrices");
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

    await vi.waitFor(() => {
      expect(subscriber).toHaveBeenCalled();
    });

    const pricesArg = subscriber.mock.calls[subscriber.mock.calls.length - 1][0];
    expect(pricesArg["RELIANCE"]).toBeDefined();
    expect(pricesArg["RELIANCE"].ltp).toBe(1417.4);
    expect(pricesArg["TCS"]).toBeDefined();
    expect(pricesArg["TCS"].ltp).toBe(2485.1);
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

    const { useLivePrices } = await import("./useLivePrices");
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

    await vi.waitFor(() => {
      expect(subscriber).toHaveBeenCalled();
    });

    const pricesArg = subscriber.mock.calls[subscriber.mock.calls.length - 1][0];
    expect(pricesArg["RELIANCE"].ltp).toBe(100);
  });

  test("handles fetch failure gracefully", async () => {
    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    const { useLivePrices } = await import("./useLivePrices");

    function TestComponent() {
      const { subscribe, getPrices } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return <div data-testid="lptest" />;
    }

    render(<TestComponent />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("lptest")).toBeInTheDocument();
    });
  });

  test("returns empty prices before any events", async () => {
    const mockResponse = createMockSSEResponse([]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    const { useLivePrices } = await import("./useLivePrices");

    function TestComponent() {
      const { getPrices } = useLivePrices();
      const prices = getPrices();
      expect(Object.keys(prices)).toHaveLength(0);
      return null;
    }

    render(<TestComponent />);
  });

  test("cleans up on unmount", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const mockResponse = createMockSSEResponse([
      {
        event: "price",
        data: JSON.stringify({ type: "price", symbol: "RELIANCE", ltp: 100 }),
      },
    ]);
    (global.fetch as any).mockResolvedValue(mockResponse);

    const { useLivePrices } = await import("./useLivePrices");

    function TestComponent() {
      const { subscribe } = useLivePrices();
      useEffect(() => {
        const unsub = subscribe(() => {});
        return () => unsub();
      }, [subscribe]);
      return null;
    }

    const { unmount } = render(<TestComponent />);

    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    unmount();

    await vi.waitFor(() => {
      expect(abortSpy).toHaveBeenCalled();
    });
  });
});
