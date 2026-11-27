// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@solidjs/testing-library";
import type { Component } from "solid-js";

const { mockFetchNews, mockFetchNewsSources } = vi.hoisted(() => ({
  mockFetchNews: vi.fn(),
  mockFetchNewsSources: vi.fn(),
}));

vi.mock("../../api/news", () => ({
  fetchNews: (...args: unknown[]) => mockFetchNews(...args),
  fetchNewsSources: (...args: unknown[]) => mockFetchNewsSources(...args),
}));

import { ApiError } from "../../api/apiError";
import { useNewsList } from "./useNewsList";

let api: ReturnType<typeof useNewsList>;
const Probe: Component = () => {
  api = useNewsList();
  return null;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchNewsSources.mockResolvedValue([]);
  mockFetchNews.mockResolvedValue([]);
});

describe("useNewsList typed errors", () => {
  it("a 401 surfaces status + kind while error stays renderable as a string", async () => {
    mockFetchNews.mockRejectedValueOnce(new ApiError("Session expired", 401));
    render(() => <Probe />);

    await vi.waitFor(() => expect(api.error()).toBe("Session expired"));
    expect(api.apiError()).toMatchObject({ status: 401, kind: "unauthorized" });
    expect(api.apiError()?.message).toBe(api.error());
  });

  it("a 429 carries retryAfterMs from the header", async () => {
    mockFetchNews.mockRejectedValueOnce(new ApiError("Slow down", 429, 5000));
    render(() => <Probe />);

    await vi.waitFor(() => expect(api.apiError()?.status).toBe(429));
    expect(api.apiError()).toMatchObject({
      kind: "rate_limited",
      retryAfterMs: 5000,
    });
  });

  it("an abort is a silent no-op", async () => {
    mockFetchNews.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    render(() => <Probe />);

    await vi.waitFor(() => expect(api.loading()).toBe(false));
    expect(api.apiError()).toBeNull();
    expect(api.error()).toBeNull();
  });
});
