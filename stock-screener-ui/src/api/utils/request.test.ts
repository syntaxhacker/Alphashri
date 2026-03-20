import { describe, expect, test } from "vitest";
import { buildUrl, handleApiError } from "./request";

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
