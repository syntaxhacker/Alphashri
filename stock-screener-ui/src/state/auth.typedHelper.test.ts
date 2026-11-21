// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithAuth, fetchJsonWithAuth, toApiError } from "./auth";
import { ApiError } from "../api/apiError";

function response(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("auth typed helper (additive)", () => {
  it("(e) fetchWithAuth still returns a bare Response to direct callers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(true, 200, { hello: "world" })));

    const result = await fetchWithAuth("http://localhost/api/thing");

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ hello: "world" });
    // One declared parameter (options has a default) — the signature is unchanged.
    expect(fetchWithAuth.length).toBe(1);
  });

  it("fetchJsonWithAuth returns byte-identical success data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(true, 200, { hello: "world" })));

    await expect(fetchJsonWithAuth("http://localhost/api/thing")).resolves.toEqual({
      hello: "world",
    });
  });

  it("fetchJsonWithAuth throws a typed ApiError on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(false, 401, { detail: "Session expired" })),
    );

    const err = await fetchJsonWithAuth("http://localhost/api/thing").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, kind: "unauthorized", message: "Session expired" });
  });

  it("toApiError(response) builds the shared contract", async () => {
    const err = await toApiError(response(false, 500, { detail: "boom" }), "fallback");

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, kind: "server", message: "boom" });
  });
});
