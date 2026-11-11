import { beforeEach, describe, expect, test, vi } from "vitest";
import { API_BASE } from "@/api/config";

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));
vi.mock("@/state/auth", () => ({ fetchWithAuth }));

import {
  NIFTY_INTEL_URL,
  fetchNiftyIntel,
  formatIntelAsOf,
} from "./niftyIntel";

beforeEach(() => {
  fetchWithAuth.mockReset();
});

describe("fetchNiftyIntel", () => {
  test("passes the frame's date and expiry as query params", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ date: "2026-10-20", expiry: "2026-10-23" }),
    });

    const intel = await fetchNiftyIntel(undefined, {
      date: "2026-10-20",
      expiry: "2026-10-23",
    });

    expect(fetchWithAuth).toHaveBeenCalledWith(
      `${NIFTY_INTEL_URL}?date=2026-10-20&expiry=2026-10-23`,
      { signal: undefined },
    );
    expect(NIFTY_INTEL_URL).toBe(`${API_BASE}/api/reports/nifty/intel`);
    expect(intel.date).toBe("2026-10-20");
    expect(intel.expiry).toBe("2026-10-23");
  });

  test("omits empty params and lets the backend default the session", async () => {
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({}) });
    await fetchNiftyIntel();
    expect(fetchWithAuth).toHaveBeenCalledWith(NIFTY_INTEL_URL, { signal: undefined });
  });

  test("throws on a non-OK response", async () => {
    fetchWithAuth.mockResolvedValue({ ok: false, status: 502 });
    await expect(fetchNiftyIntel()).rejects.toThrow("Nifty intel failed (502)");
  });
});

describe("formatIntelAsOf", () => {
  test("renders an IST label instead of the raw ISO instant", () => {
    const label = formatIntelAsOf("2026-10-21T20:00:00+05:30");
    expect(label).toContain("21 Oct 2026");
    expect(label).toContain("20:00");
    expect(label).toContain("IST");
    expect(label).not.toContain("2026-10-21T");
  });

  test("falls back to the input for unparseable values", () => {
    expect(formatIntelAsOf("not-a-date")).toBe("not-a-date");
    expect(formatIntelAsOf("")).toBe("");
    expect(formatIntelAsOf(null)).toBe("");
  });
});
