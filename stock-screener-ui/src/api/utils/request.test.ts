import { describe, expect, test, vi, beforeEach } from "vitest";
import { buildUrl, handleApiError, apiGet, apiPost, apiPut, apiDelete, apiPostAction } from "./request";

vi.mock("../../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../../state/auth";

const mockedFetchWithAuth = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("apiGet", () => {
  test("sends GET with auth headers", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "test" }),
    } as any);

    const result = await apiGet("/api/test", { q: "hello" });

    expect(mockedFetchWithAuth).toHaveBeenCalledWith(
      "http://localhost:8765/api/test?q=hello",
    );
    expect(result).toEqual({ data: "test" });
  });

  test("handles non-ok response", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: () => Promise.resolve({}),
    } as any);

    await expect(apiGet("/api/test")).rejects.toThrow("Request failed: Server Error");
  });
});

describe("apiPost", () => {
  test("sends POST with JSON body", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    } as any);

    const result = await apiPost("/api/test", { name: "test" });

    expect(mockedFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/test"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      }),
    );
    expect(result).toEqual({ id: 1 });
  });

  test("sends POST without body when data is undefined", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as any);

    await apiPost("/api/test");

    expect(mockedFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/test"),
      expect.objectContaining({
        method: "POST",
        body: undefined,
      }),
    );
  });
});

describe("apiPut", () => {
  test("sends PUT with JSON body", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ updated: true }),
    } as any);

    const result = await apiPut("/api/test/1", { name: "updated" });

    expect(mockedFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/test"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(result).toEqual({ updated: true });
  });

  test("throws on non-ok response", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.reject(new SyntaxError("not json")),
    } as any);

    await expect(apiPut("/api/test/1")).rejects.toThrow("PUT request failed");
  });
});

describe("apiDelete", () => {
  test("sends DELETE", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deleted: true }),
    } as any);

    const result = await apiDelete("/api/test/1");

    expect(mockedFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/test"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result).toEqual({ deleted: true });
  });
});

describe("apiPostAction", () => {
  test("sends POST to action endpoint", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    } as any);

    const result = await apiPostAction("/api/bot/1/start");

    expect(mockedFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/bot/1/start"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ status: "ok" });
  });

  test("passes query params", async () => {
    mockedFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as any);

    await apiPostAction("/api/bot/1/start", { test_mode: true });

    expect(mockedFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("test_mode=true"),
      expect.any(Object),
    );
  });
});

describe("buildUrl", () => {
  test("returns base URL when no params provided", () => {
    const url = buildUrl("/api/test");
    expect(url).toContain("/api/test");
    expect(url).not.toContain("?");
  });

  test("returns base URL when params is empty object", () => {
    const url = buildUrl("/api/test", {});
    expect(url).toContain("/api/test");
    expect(url).not.toContain("?");
  });

  test("appends query string for string params", () => {
    const url = buildUrl("/api/test", { q: "hello", limit: "10" });
    expect(url).toContain("/api/test?");
    expect(url).toContain("q=hello");
    expect(url).toContain("limit=10");
  });

  test("converts number params to strings", () => {
    const url = buildUrl("/api/test", { limit: 10, page: 2 });
    expect(url).toContain("limit=10");
    expect(url).toContain("page=2");
  });

  test("converts boolean params to strings", () => {
    const url = buildUrl("/api/test", { active: true });
    expect(url).toContain("active=true");
  });

  test("skips undefined values", () => {
    const url = buildUrl("/api/test", { q: "hello", skip: undefined as any });
    expect(url).toContain("q=hello");
    expect(url).not.toContain("skip");
  });

  test("skips null values", () => {
    const url = buildUrl("/api/test", { q: "hello", skip: null as any });
    expect(url).toContain("q=hello");
    expect(url).not.toContain("skip");
  });

  test("skips empty string values", () => {
    const url = buildUrl("/api/test", { q: "hello", empty: "" });
    expect(url).toContain("q=hello");
    expect(url).not.toContain("empty");
  });

  test("encodes special characters in values", () => {
    const url = buildUrl("/api/test", { q: "hello world&more" });
    expect(url).toContain("q=hello+world%26more");
  });
});

describe("handleApiError", () => {
  test("throws error with detail from response body", async () => {
    const response = new Response(JSON.stringify({ detail: "Not found" }), {
      status: 404,
    });

    await expect(handleApiError(response, "Default error")).rejects.toThrow("Not found");
  });

  test("throws error with message from response body when detail is missing", async () => {
    const response = new Response(JSON.stringify({ message: "Custom message" }), {
      status: 400,
    });

    await expect(handleApiError(response, "Default error")).rejects.toThrow("Custom message");
  });

  test("prefers detail over message", async () => {
    const response = new Response(JSON.stringify({ detail: "Detail msg", message: "Msg msg" }), {
      status: 400,
    });

    await expect(handleApiError(response, "Default error")).rejects.toThrow("Detail msg");
  });

  test("throws default message when response body is not JSON", async () => {
    const response = new Response("Not JSON", {
      status: 500,
    });

    await expect(handleApiError(response, "Server error")).rejects.toThrow("Server error");
  });

  test("throws default message when response body has no detail or message", async () => {
    const response = new Response(JSON.stringify({ other: "field" }), {
      status: 500,
    });

    await expect(handleApiError(response, "Fallback")).rejects.toThrow("Fallback");
  });

  test("throws default message for empty response body", async () => {
    const response = new Response("", {
      status: 500,
    });

    await expect(handleApiError(response, "Empty error")).rejects.toThrow("Empty error");
  });
});
