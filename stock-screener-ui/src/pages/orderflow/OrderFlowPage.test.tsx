// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderFlowPage } from "./OrderFlowPage";
import { getBrokerStatus } from "@/api/brokers";
import { getExpiries, getOptionChain, getUnderlyings } from "@/api/upstoxOptions";

vi.mock("@/api/brokers", () => ({
  getBrokerStatus: vi.fn(),
  connectUpstox: vi.fn(),
}));

vi.mock("@/api/upstoxOptions", () => ({
  getUnderlyings: vi.fn(),
  getExpiries: vi.fn(),
  getOptionChain: vi.fn(),
}));

const mockStatus = vi.mocked(getBrokerStatus);
const mockUnderlyings = vi.mocked(getUnderlyings);
const mockExpiries = vi.mocked(getExpiries);
const mockOptionChain = vi.mocked(getOptionChain);

function contract(instrumentKey: string, type: "CE" | "PE", strike: number, tickSize: number) {
  return {
    instrument_key: instrumentKey,
    trading_symbol: `NIFTY ${strike} ${type}`,
    strike_price: strike,
    expiry: "2026-09-18",
    instrument_type: type,
    tick_size: tickSize,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStatus.mockResolvedValue({ connected: true, broker: "upstox", expires_in_hours: 12, expires_at: null });
  mockUnderlyings.mockResolvedValue([
    { symbol: "NIFTY", name: "Nifty 50", instrument_key: "NSE_INDEX|Nifty 50", lot_size: 50, tick_size: 0.05 },
  ]);
  mockExpiries.mockResolvedValue([{ date: "2026-09-18", weekly: true, days_to_expiry: 3 }]);
  mockOptionChain.mockResolvedValue({
    status: "ok",
    underlying: "NIFTY",
    expiry: "2026-09-18",
    spot: 104,
    chain: [
      { strike: 95, ce: contract("NSE_FO|CE|95", "CE", 95, 0.05), pe: contract("NSE_FO|PE|95", "PE", 95, 0.05) },
      { strike: 100, ce: contract("NSE_FO|CE|100", "CE", 100, 0.05), pe: contract("NSE_FO|PE|100", "PE", 100, 0.05) },
      { strike: 105, ce: contract("NSE_FO|CE|105", "CE", 105, 0.05), pe: contract("NSE_FO|PE|105", "PE", 105, 0.1) },
    ],
  });
  // Prevent happy-dom from fetching the iframe src during tests.
  const happyDOM = (window as unknown as { happyDOM?: { settings: Record<string, unknown> } }).happyDOM;
  if (happyDOM) happyDOM.settings.disableIframePageLoading = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function iframeParams(): Promise<URLSearchParams> {
  const iframe = (await screen.findByTestId("orderflow-iframe")) as HTMLIFrameElement;
  const url = new URL(iframe.getAttribute("src") || "", "http://localhost");
  return url.searchParams;
}

async function switchToOptions() {
  const user = userEvent.setup();
  await user.click(within(screen.getByTestId("orderflow-mode")).getByRole("button", { name: "Options" }));
  return user;
}

describe("OrderFlowPage", () => {
  test("embeds the visualizer with bridge url, symbol and autoconnect", async () => {
    render(<OrderFlowPage />);
    const iframe = await screen.findByTestId("orderflow-iframe");
    expect(iframe.getAttribute("src")).toContain("/orderflow/index.html");

    const params = await iframeParams();
    expect(params.get("ws")).toBe("ws://localhost:8765/ws/orderflow");
    expect(params.get("symbol")).toBe("RELIANCE");
    expect(params.get("tick")).toBe("0.05");
    expect(params.get("autoconnect")).toBe("1");
  });

  test("connect reloads the iframe with the entered symbol", async () => {
    const user = userEvent.setup();
    render(<OrderFlowPage />);
    await screen.findByTestId("orderflow-iframe");

    await user.clear(screen.getByTestId("orderflow-symbol"));
    await user.type(screen.getByTestId("orderflow-symbol"), "tcs");
    await user.click(screen.getByTestId("orderflow-connect"));

    expect((await iframeParams()).get("symbol")).toBe("TCS");
  });

  test("disables autoconnect and offers broker connect when disconnected", async () => {
    mockStatus.mockResolvedValue({ connected: false, broker: "upstox", expires_in_hours: null, expires_at: null });
    render(<OrderFlowPage />);

    expect(await screen.findByTestId("orderflow-broker-warning")).toBeInTheDocument();
    expect(screen.getByTestId("orderflow-connect-broker")).toBeInTheDocument();
    expect((await iframeParams()).get("autoconnect")).toBe("0");
  });

  test("options mode loads underlyings, expiries and chain with ATM strike default", async () => {
    render(<OrderFlowPage />);
    await screen.findByTestId("orderflow-iframe");

    await switchToOptions();

    await waitFor(() => expect(mockUnderlyings).toHaveBeenCalled());
    await waitFor(() => expect(mockExpiries).toHaveBeenCalledWith("NIFTY"));
    await waitFor(() => expect(mockOptionChain).toHaveBeenCalledWith("NIFTY", "2026-09-18"));

    const strikeSelect = screen.getByTestId("orderflow-strike");
    await waitFor(() => expect(within(strikeSelect).getByText("105")).toBeInTheDocument());
  });

  test("Use contract connects the PE contract with its tick size", async () => {
    render(<OrderFlowPage />);
    await screen.findByTestId("orderflow-iframe");

    const user = await switchToOptions();
    await waitFor(() =>
      expect(within(screen.getByTestId("orderflow-strike")).getByText("105")).toBeInTheDocument(),
    );

    await user.click(within(screen.getByTestId("orderflow-option-type")).getByRole("button", { name: "PE" }));
    await user.click(screen.getByTestId("orderflow-use-contract"));

    const params = await iframeParams();
    expect(params.get("symbol")).toBe("NSE_FO|PE|105");
    expect(params.get("tick")).toBe("0.1");
  });

  test("shows an error when the option chain fails to load", async () => {
    mockOptionChain.mockRejectedValue(new Error("boom"));
    render(<OrderFlowPage />);
    await screen.findByTestId("orderflow-iframe");

    await switchToOptions();

    expect(await screen.findByTestId("orderflow-options-error")).toBeInTheDocument();
  });
});
