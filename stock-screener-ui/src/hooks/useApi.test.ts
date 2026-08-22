// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useApi, abortPendingRequest, getAbortSignal, isAbortError } from "./useApi";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<any> }) {
  const fn = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
    if (opts?.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({}),
      ...response,
    } as Response);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  localStorage.setItem("token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("helper functions", () => {
  it("abortPendingRequest aborts previous controller", () => {
    const first = abortPendingRequest();
    const second = abortPendingRequest();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });
  it("getAbortSignal returns current signal", () => {
    const c = abortPendingRequest();
    expect(getAbortSignal()).toBe(c.signal);
  });
  it("isAbortError detects AbortError", () => {
    expect(isAbortError(new DOMException("abort", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("other"))).toBe(false);
  });
});

describe("useApi", () => {
  it("executes fetch with auth header and query params", async () => {
    const f = mockFetchOnce({ ok: true, json: async () => ({ ok: 1 }) });
    const { result } = renderHook(() =>
      useApi<{ ok: number }>({ url: "http://localhost:8765/api/test", params: { a: "1", b: undefined, c: "" }, immediate: false }),
    );
    await act(async () => {
      await result.current.execute();
    });
    expect(f).toHaveBeenCalledWith(expect.stringContaining("/api/test?a=1"), expect.objectContaining({ method: "GET" }));
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("sends JSON body for POST", async () => {
    const f = mockFetchOnce({ ok: true, json: async () => ({ id: 1 }) });
    const { result } = renderHook(() =>
      useApi({ url: "http://localhost:8765/api/test", method: "POST", body: { x: 1 }, immediate: false }),
    );
    await act(async () => {
      await result.current.execute();
    });
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ x: 1 }) });
  });

  it("supports url as function", async () => {
    const f = mockFetchOnce({ ok: true, json: async () => ({ v: 1 }) });
    const urlFn = vi.fn(() => "http://localhost:8765/api/dynamic");
    const { result } = renderHook(() => useApi({ url: urlFn, immediate: false }));
    await act(async () => {
      await result.current.execute();
    });
    expect(urlFn).toHaveBeenCalled();
    expect(f.mock.calls[0][0]).toBe("http://localhost:8765/api/dynamic");
  });

  it("sets data on success and calls onSuccess", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ hello: "world" }) });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useApi<{ hello: string }>({ url: "http://localhost:8765/api/test", onSuccess }));
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.data).toEqual({ hello: "world" });
    expect(onSuccess).toHaveBeenCalledWith({ hello: "world" });
    expect(result.current.isLoading).toBe(false);
  });

  it("sets error on non-ok response including 401 handling and calls onError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ detail: "Unauth" }) } as Response));
    const onError = vi.fn();
    const { result } = renderHook(() => useApi({ url: "http://localhost:8765/api/test", onError }));
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain("401");
    expect(onError).toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it("handles abort signal and sets isAborted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );
    const { result } = renderHook(() => useApi({ url: "http://localhost:8765/api/test" }));
    act(() => {
      result.current.execute();
    });
    await act(async () => {
      result.current.abort();
      // Also resolve via manual reject to simulate abort
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isAborted).toBe(true));
    expect(result.current.isLoading).toBe(false);
  });

  it("clears error on next execute", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error", json: async () => ({}) } as unknown as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) } as Response) as any);
    // Use two-step mock via implementation
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) return Promise.resolve({ ok: false, status: 500, statusText: "Server Error", json: async () => ({}) } as unknown as Response);
        return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: async () => ({ ok: 1 }) } as Response);
      }),
    );
    const { result } = renderHook(() => useApi({ url: "http://localhost:8765/api/test" }));
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBeTruthy();
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ ok: 1 });
  });

  it("passes abort signal to fetch", async () => {
    const f = mockFetchOnce({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useApi({ url: "http://localhost:8765/api/test" }));
    await act(async () => {
      await result.current.execute();
    });
    expect(f.mock.calls[0][1]).toHaveProperty("signal");
    expect((f.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
