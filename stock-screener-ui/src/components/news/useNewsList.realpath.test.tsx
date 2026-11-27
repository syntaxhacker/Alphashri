// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import type { Component } from "solid-js";

// Only the transport is mocked. The real `fetchNews` and the real
// `useNewsList` are exercised so a 401 can be traced from the HTTP layer to
// the store's typed `apiError` signal.
vi.mock("../../state/auth", () => ({ fetchWithAuth: vi.fn() }));

import { fetchWithAuth } from "../../state/auth";
import { useNewsList } from "./useNewsList";

const mockFetch = vi.mocked(fetchWithAuth);

function okResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as Response;
}

function errorResponse(status: number, data: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => data,
    headers: { get: () => null },
  } as unknown as Response;
}

const NEWS_ITEMS = [
  { id: 1, title: "Alpha", source: "reuters", url: "https://e/1", timestamp: "2026-01-01", summary: "a" },
  { id: 2, title: "Beta", source: "reuters", url: "https://e/2", timestamp: "2026-01-02", summary: "b" },
];

type Mode = "success" | "401" | "abort";
let mode: Mode = "success";

beforeEach(() => {
  vi.clearAllMocks();
  mode = "success";
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes("/api/news/sources")) return okResponse({ sources: [] });
    if (mode === "401") return errorResponse(401, { detail: "Session expired" });
    if (mode === "abort") throw new DOMException("Aborted", "AbortError");
    return okResponse({ items: NEWS_ITEMS });
  });
});

afterEach(() => cleanup());

let api: ReturnType<typeof useNewsList>;
const Probe: Component = () => {
  api = useNewsList();
  return null;
};

describe("fetchNews real path → useNewsList", () => {
  it("(a) a real /api/news 401 surfaces status 401 + unauthorized to the store", async () => {
    mode = "401";
    render(() => <Probe />);

    await vi.waitFor(() => expect(api.error()).toBe("Session expired"));
    expect(api.apiError()).toMatchObject({ status: 401, kind: "unauthorized" });
    expect(api.apiError()?.message).toBe(api.error());
  });

  it("(b) a real abort renders no error", async () => {
    mode = "abort";
    render(() => <Probe />);

    await vi.waitFor(() => expect(api.loading()).toBe(false));
    expect(api.apiError()).toBeNull();
    expect(api.error()).toBeNull();
  });

  it("(d) real success data is byte-identical", async () => {
    render(() => <Probe />);

    await vi.waitFor(() => expect(api.newsItems().length).toBe(2));
    expect(api.newsItems()).toEqual(NEWS_ITEMS);
    expect(api.error()).toBeNull();
  });
});
