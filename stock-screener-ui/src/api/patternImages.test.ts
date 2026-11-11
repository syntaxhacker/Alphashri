import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import {
  fetchPatternImages,
  uploadPatternImage,
  deletePatternImage,
} from "./patternImages";
import { errorResponse, nonJsonErrorResponse, okResponse } from "./apiTestMocks";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchPatternImages", () => {
  it("GETs the images map", async () => {
    mockedFetch.mockResolvedValue(
      okResponse({ images: { falling_wedge: "/api/chart-patterns/image/falling_wedge" } }),
    );

    await expect(fetchPatternImages()).resolves.toEqual({
      falling_wedge: "/api/chart-patterns/image/falling_wedge",
    });
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/chart-patterns/images"),
    );
  });

  it("defaults to an empty map when images is missing", async () => {
    mockedFetch.mockResolvedValue(okResponse({}));
    await expect(fetchPatternImages()).resolves.toEqual({});
  });

  it("throws the server detail on failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "boom" }));
    await expect(fetchPatternImages()).rejects.toThrow("boom");
  });
});

describe("uploadPatternImage", () => {
  it("PUTs multipart FormData with the file field", async () => {
    mockedFetch.mockResolvedValue(
      okResponse({ pattern_id: "falling_wedge", url: "/api/chart-patterns/image/falling_wedge" }),
    );
    const file = new File(["pixels"], "wedge.png", { type: "image/png" });

    const result = await uploadPatternImage("falling_wedge", file);
    expect(result.pattern_id).toBe("falling_wedge");

    const [url, options] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/chart-patterns/image/falling_wedge");
    expect(options?.method).toBe("PUT");
    const body = options?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("file")).toBe(file);
  });

  it("URL-encodes the pattern id", async () => {
    mockedFetch.mockResolvedValue(okResponse({ pattern_id: "x", url: "/u" }));
    await uploadPatternImage("weird/id", new File(["x"], "a.png", { type: "image/png" }));
    expect(mockedFetch.mock.calls[0][0]).toContain("/image/weird%2Fid");
  });

  it("throws the server detail on non-OK", async () => {
    mockedFetch.mockResolvedValue(errorResponse(415, { detail: "unsupported image type" }));
    await expect(
      uploadPatternImage("falling_wedge", new File(["x"], "a.txt", { type: "text/plain" })),
    ).rejects.toThrow("unsupported image type");
  });
});

describe("deletePatternImage", () => {
  it("DELETEs the pattern image endpoint", async () => {
    mockedFetch.mockResolvedValue(okResponse({ status: "ok" }));

    await expect(deletePatternImage("falling_wedge")).resolves.toBeUndefined();
    const [url, options] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/chart-patterns/image/falling_wedge");
    expect(options?.method).toBe("DELETE");
  });

  it("throws the server detail on non-OK", async () => {
    mockedFetch.mockResolvedValue(errorResponse(403, { detail: "Admin access required" }));
    await expect(deletePatternImage("falling_wedge")).rejects.toThrow("Admin access required");
  });

  it("URL-encodes the pattern id", async () => {
    mockedFetch.mockResolvedValue(okResponse({ status: "ok" }));
    await deletePatternImage("weird/id");
    expect(mockedFetch.mock.calls[0][0]).toContain("/image/weird%2Fid");
  });
});

describe("error-field + non-JSON fallbacks", () => {
  it("fetchPatternImages reads the error field", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { error: "images failed" }));
    await expect(fetchPatternImages()).rejects.toThrow("images failed");
  });

  it("fetchPatternImages falls back when the error body is not JSON", async () => {
    mockedFetch.mockResolvedValue(nonJsonErrorResponse(500));
    await expect(fetchPatternImages()).rejects.toThrow(
      "Failed to load pattern images (500)",
    );
  });

  it("uploadPatternImage reads the error field", async () => {
    mockedFetch.mockResolvedValue(errorResponse(400, { error: "bad upload" }));
    await expect(
      uploadPatternImage("p", new File(["x"], "a.png", { type: "image/png" })),
    ).rejects.toThrow("bad upload");
  });

  it("uploadPatternImage falls back when the error body is not JSON", async () => {
    mockedFetch.mockResolvedValue(nonJsonErrorResponse(500));
    await expect(
      uploadPatternImage("p", new File(["x"], "a.png", { type: "image/png" })),
    ).rejects.toThrow("Failed to upload image (500)");
  });

  it("deletePatternImage reads the error field", async () => {
    mockedFetch.mockResolvedValue(errorResponse(403, { error: "forbidden" }));
    await expect(deletePatternImage("p")).rejects.toThrow("forbidden");
  });

  it("deletePatternImage falls back when the error body is not JSON", async () => {
    mockedFetch.mockResolvedValue(nonJsonErrorResponse(404));
    await expect(deletePatternImage("p")).rejects.toThrow("Failed to delete image (404)");
  });
});
