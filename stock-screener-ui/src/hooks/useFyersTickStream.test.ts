// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderSolidHook } from "@/test-utils/solidRenderHook";
import {
  __resetFyersTickStream,
  buildFyersTicksUrl,
  fyersBackoffMs,
  useFyersTickStream,
} from "./useFyersTickStream";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readyState = 0;
  closed = false;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const mounted: Array<{ unmount: () => void }> = [];
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
  __resetFyersTickStream();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function mount(symbols = ["NIFTY"], enabled = true) {
  const hook = renderSolidHook(() =>
    useFyersTickStream({ symbols: () => symbols, enabled: () => enabled }),
  );
  mounted.push(hook);
  return hook;
}

function tick(over: Record<string, unknown> = {}) {
  return {
    type: "tick",
    symbol: "NIFTY50-INDEX",
    requested_symbol: "NIFTY",
    data: { ltp: 24_850.5, volume: 42 },
    ts: "2026-11-19T10:00:00+05:30",
    ...over,
  };
}

describe("useFyersTickStream", () => {
  test("a tick updates the last-tick signal for its symbol", async () => {
    const hook = mount();
    await flush();
    expect(hook.result.current.lastTick("NIFTY")).toBeNull();

    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.emit(tick());

    expect(hook.result.current.lastTick("NIFTY")).toMatchObject({
      symbol: "NIFTY",
      ltp: 24_850.5,
    });
    expect(hook.result.current.lastTick("SENSEX")).toBeNull();
  });

  test("two mounts share one socket (constructor runs once)", async () => {
    mount();
    mount();
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test("a close triggers exactly one reconnect after backoff", async () => {
    const hook = mount();
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].drop();
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(hook.result.current.state()).toBe("reconnecting");
    expect(hook.result.current.isLive()).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test("disconnected and market_closed are distinguishable", async () => {
    const hook = mount();
    await flush();
    const ws = FakeWebSocket.instances[0];

    ws.emit({ type: "status", state: "market_closed", reason: "market_closed" });
    expect(hook.result.current.state()).toBe("market_closed");
    expect(hook.result.current.isMarketClosed()).toBe(true);
    expect(hook.result.current.isDisconnected()).toBe(false);

    ws.emit({ type: "status", state: "disconnected", reason: "no_token" });
    expect(hook.result.current.state()).toBe("disconnected");
    expect(hook.result.current.isDisconnected()).toBe(true);
    expect(hook.result.current.isMarketClosed()).toBe(false);
  });

  test("unmount closes the socket and no reconnect follows", async () => {
    const hook = mount();
    await flush();
    const ws = FakeWebSocket.instances[0];

    hook.unmount();
    mounted.length = 0;
    expect(ws.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test("one socket per symbol; each symbol's ticks stay isolated", async () => {
    const hook = mount(["NIFTY", "SENSEX"]);
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(2);

    const [nifty, sensex] = FakeWebSocket.instances;
    nifty.emit(tick());
    sensex.emit(
      tick({
        symbol: "SENSEX-INDEX",
        requested_symbol: "SENSEX",
        data: { ltp: 81_000 },
      }),
    );

    expect(hook.result.current.lastTick("NIFTY")?.ltp).toBe(24_850.5);
    expect(hook.result.current.lastTick("SENSEX")?.ltp).toBe(81_000);
  });

  test("no token in the URL and no auth/subscribe messages are sent", async () => {
    mount(["NIFTY"]);
    await flush();
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe(buildFyersTicksUrl("http://localhost:8765", "NIFTY"));
    expect(ws.url).not.toContain("token");
    ws.open();
    expect(ws.sent).toEqual([]);
  });

  test("connecting, market_open and error statuses are surfaced, not ignored", async () => {
    const hook = mount();
    await flush();
    const ws = FakeWebSocket.instances[0];

    ws.emit({ type: "status", state: "connecting", reason: "subscribed" });
    expect(hook.result.current.state()).toBe("connecting");
    ws.emit({ type: "status", state: "market_open", reason: "market_open" });
    expect(hook.result.current.state()).toBe("market_open");
    ws.emit({ type: "status", state: "error", reason: "unsupported_symbol" });
    expect(hook.result.current.state()).toBe("error");
  });

  test("backoff is 1s, 2s, 4s … capped at 15s", () => {
    expect([0, 1, 2, 3, 4, 10].map(fyersBackoffMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ]);
  });
});
