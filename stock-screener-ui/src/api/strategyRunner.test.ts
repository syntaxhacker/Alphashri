import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runStrategyRunner } from "./strategyRunner";

describe("runStrategyRunner", () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  const config = {
    bot_uuids: ["bot-1", "bot-2"],
    date: "2026-05-01",
    end_date: "2026-05-10",
    symbols: ["RELIANCE", "TCS"],
  };

  it("sends POST to /api/strategy-runner/run with JSON body", async () => {
    const mockData = { trades: [], summary: {} };
    mockFetch.mockResolvedValue({ ok: true, json: async () => mockData } as Response);

    const result = await runStrategyRunner(config as any);

    expect(result).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/strategy-runner/run");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual(expect.objectContaining({ "Content-Type": "application/json" }));
    expect(JSON.parse(opts.body as string)).toEqual(config);
  });

  it("throws error envelope on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(runStrategyRunner(config as any)).rejects.toThrow("Strategy runner failed: 500");
  });

  it("throws on 400 with status in message", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 } as Response);
    await expect(runStrategyRunner(config as any)).rejects.toThrow("400");
  });

  it("propagates fetch network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    await expect(runStrategyRunner(config as any)).rejects.toThrow("Network error");
  });

  it("sends empty symbols array correctly", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const emptyConfig = { ...config, symbols: [] };
    await runStrategyRunner(emptyConfig as any);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.symbols).toEqual([]);
  });

  it("sends single bot uuid", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    const single = { ...config, bot_uuids: ["only-one"] };
    await runStrategyRunner(single as any);
    expect(JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string).bot_uuids).toEqual(["only-one"]);
  });
});
