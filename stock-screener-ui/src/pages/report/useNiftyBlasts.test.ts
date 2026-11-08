// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useNiftyBlasts } from "./useNiftyBlasts";
import { fetchNiftyBlasts } from "@/api/reportNifty";
import { flashAlertTitle, playAlertSound } from "./alertSound";

vi.mock("@/api/reportNifty", () => ({ fetchNiftyBlasts: vi.fn() }));
vi.mock("./alertSound", () => ({
  playAlertSound: vi.fn(),
  flashAlertTitle: vi.fn(),
  alertsMuted: vi.fn(() => false),
}));

function blast(over: Record<string, unknown> = {}) {
  return {
    kind: "spot" as const,
    t: "2026-10-26T12:28:45+05:30",
    side: null,
    delta: 14.5,
    label: "SPOT ↑ +14.5 pts / 10s",
    detail: "22,598.0 → 22,612.5",
    severity: "critical" as const,
    bias: "bull" as const,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Prime the hook under fake timers with an empty first fetch. */
async function primeEmptyBlasts() {
  vi.useFakeTimers();
  vi.mocked(fetchNiftyBlasts).mockResolvedValueOnce([]);
  const { result } = renderHook(() => useNiftyBlasts(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return result;
}

describe("useNiftyBlasts", () => {
  test("primes history, then alerts only on a new blast", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchNiftyBlasts).mockResolvedValueOnce([blast()]);
    const { result } = renderHook(() => useNiftyBlasts(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.blast).toBeNull();
    expect(playAlertSound).not.toHaveBeenCalled();

    vi.mocked(fetchNiftyBlasts).mockResolvedValue([
      blast({ t: "2026-10-26T12:29:00+05:30", delta: -16, label: "SPOT ↓ -16.0 pts / 10s", bias: "bear" }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.blast?.bias).toBe("bear");
    expect(playAlertSound).toHaveBeenCalledWith("critical");
    expect(flashAlertTitle).toHaveBeenCalledWith("SPOT ↓ -16.0 pts / 10s");
  });


  test("suppresses opening-bell noise below the raised gate", async () => {
    const result = await primeEmptyBlasts();

    vi.mocked(fetchNiftyBlasts).mockResolvedValue([
      blast({
        t: "2026-11-06T09:16:59+05:30",
        delta: 34.8,
        label: "SPOT ↑ +34.8 pts / 30s",
        detail: "24,410.6 → 24,445.4",
      }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(result.current.blast).toBeNull();
    expect(playAlertSound).not.toHaveBeenCalled();
    expect(flashAlertTitle).not.toHaveBeenCalled();
  });

  test("allows a large opening blast, then holds the one-per-minute cue", async () => {
    const result = await primeEmptyBlasts();

    vi.mocked(fetchNiftyBlasts).mockResolvedValue([
      blast({
        t: "2026-11-06T09:17:30+05:30",
        delta: 60,
        label: "SPOT ↑ +60.0 pts / 30s",
      }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.blast?.delta).toBe(60);
    expect(playAlertSound).toHaveBeenCalledTimes(1);

    vi.mocked(fetchNiftyBlasts).mockResolvedValue([
      blast({
        t: "2026-11-06T09:18:00+05:30",
        delta: 70,
        label: "SPOT ↑ +70.0 pts / 30s",
      }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.blast?.delta).toBe(60);
    expect(playAlertSound).toHaveBeenCalledTimes(1);
  });

  test("a volume blast uses the softer alert blip", async () => {
    const result = await primeEmptyBlasts();

    vi.mocked(fetchNiftyBlasts).mockResolvedValue([
      blast({
        kind: "volume",
        side: "CE",
        severity: "warning",
        bias: "neutral",
        label: "CE VOL 12M / 10s",
        t: "2026-10-26T12:30:00+05:30",
      }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.blast?.kind).toBe("volume");
    expect(playAlertSound).toHaveBeenCalledWith("alert");
  });

  test("does nothing while disabled", async () => {
    vi.useFakeTimers();
    renderHook(() => useNiftyBlasts(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchNiftyBlasts).not.toHaveBeenCalled();
  });

  test("each poll is abortable and a new blast keeps at most one alert timer", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchNiftyBlasts).mockResolvedValue([]);
    const { unmount } = renderHook(() => useNiftyBlasts(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The poll passes an AbortSignal so an unmount cancels the request.
    expect(vi.mocked(fetchNiftyBlasts)).toHaveBeenCalledWith(
      5,
      40,
      expect.any(AbortSignal),
    );
    const signal = vi.mocked(fetchNiftyBlasts).mock.calls[0][2];
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
