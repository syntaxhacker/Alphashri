// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { BrokerStatus } from "./brokers";
import { getBrokerStatus, connectUpstox, disconnectUpstox } from "./brokers";

vi.mock("./utils", () => ({
  apiGet: vi.fn(),
  apiPostAction: vi.fn(),
  API_BASE: "http://localhost:8765",
}));

import { apiGet, apiPostAction } from "./utils";

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPostAction = vi.mocked(apiPostAction);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Brokers API", () => {
  test("getBrokerStatus fetches broker connections", async () => {
    const status: BrokerStatus = { connected: true, broker: "upstox", expires_in_hours: 12, expires_at: "2024-01-02T00:00:00" };
    mockedApiGet.mockResolvedValue(status);

    const result = await getBrokerStatus();

    expect(mockedApiGet).toHaveBeenCalledWith("/api/brokers/status");
    expect(result).toEqual(status);
  });

  test("connectUpstox opens OAuth URL", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    connectUpstox();

    expect(openSpy).toHaveBeenCalledWith("http://localhost:8765/api/brokers/upstox/auth", "_blank");
    openSpy.mockRestore();
  });

  test("disconnectUpstox sends disconnect request", async () => {
    mockedApiPostAction.mockResolvedValue(undefined);

    await disconnectUpstox();

    expect(mockedApiPostAction).toHaveBeenCalledWith("/api/brokers/upstox/disconnect");
  });
});
