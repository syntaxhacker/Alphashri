import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { createScreener, updateScreener, deleteScreener } from "./screeners";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

const mockScreener = { id: "screener-1", label: "My Screener", description: "" };

describe("createScreener", () => {
  it("sends POST with payload", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => mockScreener } as Response);

    const result = await createScreener({ name: "My Screener" });

    expect(result).toEqual(mockScreener);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/screeners"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("My Screener"),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Name required" }),
    } as Response);

    await expect(createScreener({ name: "" })).rejects.toThrow("Name required");
  });

  it("throws with status when no detail", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    await expect(createScreener({ name: "" })).rejects.toThrow("HTTP 500");
  });
});

describe("updateScreener", () => {
  it("sends PUT with partial payload", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => mockScreener } as Response);

    const result = await updateScreener("screener-1", { name: "Updated" });

    expect(result).toEqual(mockScreener);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/screeners/screener-1"),
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining("Updated"),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Not found" }),
    } as Response);

    await expect(updateScreener("bad-id", {})).rejects.toThrow("Not found");
  });
});

describe("deleteScreener", () => {
  it("sends DELETE", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    await deleteScreener("screener-1");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/screeners/screener-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Not found" }),
    } as Response);

    await expect(deleteScreener("bad-id")).rejects.toThrow("Not found");
  });
});
