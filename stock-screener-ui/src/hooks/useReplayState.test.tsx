// @vitest-environment jsdom
import { describe, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useReplayState } from "./useReplayState";
import * as rs from "../state/replay";

vi.mock("../state/replay", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof rs;
  return {
    ...actual,
    subscribeToReplay: vi.fn(() => vi.fn()),
  };
});

vi.mock("../api/replay", () => ({
  runReplay: vi.fn(),
  fetchReplaySymbols: vi.fn(),
}));

vi.mock("./useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

describe("useReplayState", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/replay");
  });

  it("returns combined state and actions", async () => {
    renderHook(() => useReplayState());
  });
});
