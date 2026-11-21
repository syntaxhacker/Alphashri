import { describe, expect, test } from "vitest";
import {
  ApiError,
  apiErrorFromResponse,
  asApiError,
  isAbortError,
  kindFromStatus,
} from "./apiError";
import { OptionDockError } from "./optionsDock";
import { PositioningApiError } from "./upstoxOptions";

describe("ApiError", () => {
  test("carries status, kind, retryAfterMs and message", () => {
    const err = new ApiError("Slow down", 429, 8000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiError");
    expect(err.message).toBe("Slow down");
    expect(err.status).toBe(429);
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfterMs).toBe(8000);
  });

  test("derives the kind from status", () => {
    expect(kindFromStatus(401)).toBe("unauthorized");
    expect(kindFromStatus(403)).toBe("unauthorized");
    expect(kindFromStatus(429)).toBe("rate_limited");
    expect(kindFromStatus(503)).toBe("server");
    expect(kindFromStatus(404)).toBe("client");
    expect(kindFromStatus(0)).toBe("network");
    expect(kindFromStatus(null)).toBe("network");
  });
});

describe("apiErrorFromResponse", () => {
  test("keeps a 401 status and reads the server detail", async () => {
    const response = new Response(JSON.stringify({ detail: "Session expired" }), { status: 401 });
    const err = await apiErrorFromResponse(response, "Request failed");
    expect(err.status).toBe(401);
    expect(err.kind).toBe("unauthorized");
    expect(err.message).toBe("Session expired");
  });

  test("carries Retry-After on a 429", async () => {
    const response = new Response(JSON.stringify({ detail: "Slow down" }), {
      status: 429,
      headers: { "Retry-After": "12" },
    });
    const err = await apiErrorFromResponse(response, "Request failed");
    expect(err.status).toBe(429);
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfterMs).toBe(12_000);
  });

  test("falls back to the default message on an unparseable body", async () => {
    const response = new Response("not json", { status: 500 });
    const err = await apiErrorFromResponse(response, "Server unavailable");
    expect(err.status).toBe(500);
    expect(err.kind).toBe("server");
    expect(err.message).toBe("Server unavailable");
  });
});

describe("isAbortError / asApiError", () => {
  test("recognises AbortError from both DOMException and Error", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    const plain = new Error("cancelled");
    plain.name = "AbortError";
    expect(isAbortError(plain)).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
  });

  test("asApiError passes an existing ApiError through unchanged", () => {
    const original = new ApiError("nope", 401);
    expect(asApiError(original, "fallback")).toBe(original);
  });

  test("asApiError preserves a plain error's message", () => {
    const wrapped = asApiError(new Error("plain failure"), "fallback");
    expect(wrapped.message).toBe("plain failure");
    expect(wrapped.kind).toBe("network");
  });

  test("asApiError marks an abort with the aborted kind", () => {
    const wrapped = asApiError(new DOMException("Aborted", "AbortError"), "fallback");
    expect(wrapped.kind).toBe("aborted");
  });
});

describe("unified legacy error classes", () => {
  test("PositioningApiError is an ApiError and keeps its fields", () => {
    const err = new PositioningApiError("Failed to fetch positioning", 429, 5000);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(PositioningApiError);
    expect(err.name).toBe("PositioningApiError");
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(5000);
  });

  test("OptionDockError is an ApiError and keeps its legacy kind", () => {
    const err = new OptionDockError("auth", "Reconnect Upstox in Settings", 401);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(OptionDockError);
    expect(err.name).toBe("OptionDockError");
    expect(err.kind).toBe("auth");
    expect(err.status).toBe(401);
  });
});
