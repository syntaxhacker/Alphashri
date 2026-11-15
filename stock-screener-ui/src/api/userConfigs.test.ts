// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  deleteUserConfig,
  getUserConfig,
  putUserConfig,
  UserConfigError,
} from "./userConfigs";
import { fetchWithAuth } from "../state/auth";

vi.mock("../state/auth", () => ({ fetchWithAuth: vi.fn() }));

vi.mock("./config", () => ({ API_BASE: "http://api.test" }));

const mockFetch = vi.mocked(fetchWithAuth);

function response(ok: boolean, body: unknown, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const ENVELOPE = {
  scope: "market.filters",
  version: 1,
  saved: true,
  updated_at: "2026-11-15T09:41:22.192Z",
  config: { universe: "nifty500" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserConfig", () => {
  test("GETs the encoded scope and returns the envelope", async () => {
    mockFetch.mockResolvedValue(response(true, ENVELOPE));

    const result = await getUserConfig("market.filters");
    expect(result).toEqual(ENVELOPE);
    expect(mockFetch.mock.calls[0][0]).toBe("http://api.test/api/user-configs/market.filters");
  });

  test("a dotted scope is not mangled into a path segment", async () => {
    mockFetch.mockResolvedValue(response(true, ENVELOPE));
    await getUserConfig("report.layout");
    expect(mockFetch.mock.calls[0][0]).toBe("http://api.test/api/user-configs/report.layout");
  });

  test("404 raises a typed error the store can treat as 'API absent'", async () => {
    mockFetch.mockResolvedValue(response(false, { detail: "unknown_scope" }, 404));

    const error = await getUserConfig("nope").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserConfigError);
    expect((error as UserConfigError).status).toBe(404);
    expect((error as UserConfigError).code).toBe("unknown_scope");
  });
});

describe("putUserConfig", () => {
  test("sends {config, version} and only adds If-Match when a revision exists", async () => {
    mockFetch.mockResolvedValue(response(true, ENVELOPE));

    await putUserConfig("market.filters", { universe: "nifty500" }, { version: 1 });
    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      config: { universe: "nifty500" },
      version: 1,
    });
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["If-Match"]).toBeUndefined();
  });

  test("passes the base revision as If-Match and honours keepalive", async () => {
    mockFetch.mockResolvedValue(response(true, ENVELOPE));

    await putUserConfig(
      "market.filters",
      { universe: "nifty50" },
      { version: 1, ifMatch: "2026-11-15T09:41:22.192Z", keepalive: true },
    );
    const [, init] = mockFetch.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["If-Match"]).toBe("2026-11-15T09:41:22.192Z");
    expect(init?.keepalive).toBe(true);
  });

  test("409 surfaces the server's current envelope for adoption", async () => {
    mockFetch.mockResolvedValue(
      response(false, { detail: "conflict", current: ENVELOPE }, 409),
    );

    const error = (await putUserConfig("market.filters", {}).catch(
      (e: unknown) => e,
    )) as UserConfigError;
    expect(error.status).toBe(409);
    expect((error.payload as { current: unknown }).current).toEqual(ENVELOPE);
  });

  test("422 keeps the code so the store can refuse to retry the payload", async () => {
    mockFetch.mockResolvedValue(response(false, { detail: "config_too_large" }, 422));

    const error = (await putUserConfig("market.filters", {}).catch(
      (e: unknown) => e,
    )) as UserConfigError;
    expect(error.status).toBe(422);
    expect(error.code).toBe("config_too_large");
  });
});

describe("deleteUserConfig", () => {
  test("DELETEs and returns the idempotent result", async () => {
    mockFetch.mockResolvedValue(
      response(true, { scope: "market.filters", deleted: false }),
    );

    await expect(deleteUserConfig("market.filters")).resolves.toEqual({
      scope: "market.filters",
      deleted: false,
    });
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });
});
