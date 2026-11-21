import { describe, expect, test, vi } from "vitest";
import { fetchWithAuth } from "../../state/auth";
import { ApiError } from "../apiError";
import { buildUrl, handleApiError, jsonOrThrow, safeGet } from "./request";

vi.mock("../../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchWithAuth);

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

  test("throws a typed ApiError that keeps the status and kind", async () => {
    const response = new Response(JSON.stringify({ detail: "Session expired" }), { status: 401 });

    const error = await handleApiError(response, "Default error").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).kind).toBe("unauthorized");
    expect((error as ApiError).message).toBe("Session expired");
  });
});

describe("jsonOrThrow typed errors", () => {
  test("a 401 surfaces status and unauthorized kind", async () => {
    const response = new Response(JSON.stringify({ detail: "Session expired" }), { status: 401 });
    const error = await jsonOrThrow(response, "Request failed").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).kind).toBe("unauthorized");
    expect((error as ApiError).message).toBe("Session expired");
  });

  test("a 429 carries retryAfterMs from the Retry-After header", async () => {
    const response = new Response(JSON.stringify({ detail: "Slow down" }), {
      status: 429,
      headers: { "Retry-After": "9" },
    });
    const error = await jsonOrThrow(response, "Request failed").catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(429);
    expect((error as ApiError).kind).toBe("rate_limited");
    expect((error as ApiError).retryAfterMs).toBe(9000);
  });

  test("a malformed success body still carries the response status", async () => {
    const response = new Response("not json", { status: 200 });
    const error = await jsonOrThrow(response, "Bad payload").catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(200);
    expect((error as ApiError).message).toBe("Bad payload");
  });
});

describe("safeGet", () => {
  test("throws a typed ApiError instead of returning the fallback on a 401", async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({ detail: "No token" }), { status: 401 }));
    const error = await safeGet("https://example.test/data", [] as number[], "Fetch failed").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).kind).toBe("unauthorized");
  });

  test("throws a typed ApiError on a network failure instead of returning the fallback", async () => {
    mockedFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await safeGet("https://example.test/data", [] as number[], "Fetch failed").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("network");
  });

  test("returns the parsed JSON on success", async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify([1, 2]), { status: 200 }));
    await expect(safeGet("https://example.test/data", [] as number[])).resolves.toEqual([1, 2]);
  });
});
