// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OrderFlowPage } from "./OrderFlowPage";
import { getBrokerStatus } from "@/api/brokers";
import { getExpiries, getOptionChain, getUnderlyings } from "@/api/upstoxOptions";

vi.mock("@/api/brokers", () => ({
  getBrokerStatus: vi.fn(),
  connectUpstox: vi.fn(),
}));

const mockJournalFiles = vi.fn();

vi.mock("@/api/orderflowJournal", () => ({
  listJournalFiles: (...args: unknown[]) => mockJournalFiles(...args),
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
  mockJournalFiles.mockResolvedValue([]);
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

/** useNavigate() needs a Router, so every render goes through one. */
function renderPage(initialEntry = "/orderflow") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/orderflow" element={<OrderFlowPage />} />
        <Route path="/settings" element={<div data-testid="settings-route" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function postAuthError(broker = "fyers_tbt", message = "Fyers TBT session expired (403 Forbidden).") {
  window.dispatchEvent(
    new MessageEvent("message", { data: { type: "ofm-auth-error", broker, message } }),
  );
}

async function switchToOptions() {
  const user = userEvent.setup();
  await user.click(within(screen.getByTestId("orderflow-mode")).getByRole("button", { name: "Options" }));
  return user;
}

describe("OrderFlowPage", () => {
  test("embeds the visualizer with bridge url, symbol and autoconnect", async () => {
    renderPage();
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
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await user.clear(screen.getByTestId("orderflow-symbol"));
    await user.type(screen.getByTestId("orderflow-symbol"), "tcs");
    await user.click(screen.getByTestId("orderflow-connect"));

    expect((await iframeParams()).get("symbol")).toBe("TCS");
  });

  test("defaults to the Fyers TBT feed without gating on the Upstox session", async () => {
    mockStatus.mockResolvedValue({ connected: false, broker: "upstox", expires_in_hours: null, expires_at: null });
    renderPage();

    const params = await iframeParams();
    expect(params.get("broker")).toBe("fyers_tbt");
    expect(params.get("autoconnect")).toBe("1");
    expect(screen.queryByTestId("orderflow-broker-warning")).not.toBeInTheDocument();
  });

  test("disables autoconnect and offers broker connect for the Upstox feed when disconnected", async () => {
    mockStatus.mockResolvedValue({ connected: false, broker: "upstox", expires_in_hours: null, expires_at: null });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await user.click(within(screen.getByTestId("orderflow-broker")).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Upstox · 5 lv" }));

    expect(await screen.findByTestId("orderflow-broker-warning")).toBeInTheDocument();
    expect(screen.getByTestId("orderflow-connect-broker")).toBeInTheDocument();
    expect((await iframeParams()).get("autoconnect")).toBe("0");
  });

  test("options mode loads underlyings, expiries and chain with ATM strike default", async () => {
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await switchToOptions();

    await waitFor(() => expect(mockUnderlyings).toHaveBeenCalled());
    await waitFor(() => expect(mockExpiries).toHaveBeenCalledWith("NIFTY"));
    await waitFor(() => expect(mockOptionChain).toHaveBeenCalledWith("NIFTY", "2026-09-18"));

    const strikeSelect = screen.getByTestId("orderflow-strike");
    await waitFor(() => expect(within(strikeSelect).getByText("105")).toBeInTheDocument());
  });

  test("Use contract connects the PE contract with its tick size", async () => {
    renderPage();
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
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await switchToOptions();

    expect(await screen.findByTestId("orderflow-options-error")).toBeInTheDocument();
  });
});

describe("OrderFlowPage auth failures", () => {
  test("shows a modal with a route to broker settings when the feed rejects the session", async () => {
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    postAuthError("fyers_tbt", "Fyers TBT session expired or rejected (Handshake status 403 Forbidden).");

    const modal = await screen.findByTestId("orderflow-auth-error-modal");
    expect(
      within(modal).getByRole("heading", { name: /session expired/i }),
    ).toBeInTheDocument();
    expect(within(modal).getByText(/Broker sessions expire\s+daily/i)).toBeInTheDocument();
    expect(screen.getByTestId("orderflow-auth-error-detail")).toHaveTextContent("403 Forbidden");
    expect(screen.getByTestId("orderflow-auth-error-settings")).toBeInTheDocument();
    expect(screen.getByTestId("orderflow-auth-error-retry")).toBeInTheDocument();
  });

  test("routes to the settings page from the modal", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    postAuthError();
    await user.click(await screen.findByTestId("orderflow-auth-error-settings"));

    expect(await screen.findByTestId("settings-route")).toBeInTheDocument();
  });

  test("modal can be dismissed without navigating", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    postAuthError();
    await screen.findByTestId("orderflow-auth-error-modal");
    await user.click(screen.getByTestId("orderflow-auth-error-retry"));

    await waitFor(() =>
      expect(screen.queryByTestId("orderflow-auth-error-modal")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("settings-route")).not.toBeInTheDocument();
  });

  test("plain feed errors do not open the modal", async () => {
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "error", message: "transient socket hiccup" } }),
    );

    expect(screen.queryByTestId("orderflow-auth-error-modal")).not.toBeInTheDocument();
  });

  test("ignores unrelated postMessage traffic", async () => {
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    window.dispatchEvent(new MessageEvent("message", { data: { type: "ofm-view", key: "x" } }));
    window.dispatchEvent(new MessageEvent("message", { data: "not-an-object" }));

    expect(screen.queryByTestId("orderflow-auth-error-modal")).not.toBeInTheDocument();
  });
});

describe("OrderFlowPage replay mode", () => {
  test("replay mode lists stored journals and loads the chosen one without autoconnect", async () => {
    mockJournalFiles.mockResolvedValue([
      { file: "RELIANCE_2026-09-17.jsonl", day: "2026-09-17", symbol: "RELIANCE", broker: "fyers_tbt", bytes: 55 * 1048576, modified: 1 },
      { file: "fyers_tbt_TCS_2026-09-16.jsonl", day: "2026-09-16", symbol: "TCS", broker: "fyers_tbt", bytes: 8 * 1048576, modified: 2 },
    ]);

    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await user.click(within(screen.getByTestId("orderflow-mode")).getByRole("button", { name: "Replay" }));
    await screen.findByTestId("orderflow-replay-row");

    // newest day first, and the newest file is selected by default
    await waitFor(() => expect(mockJournalFiles).toHaveBeenCalled());
    const params = await iframeParams();
    expect(params.get("replay")).toBe("1");
    expect(params.get("symbol")).toBe("RELIANCE");
    expect(params.get("day")).toBe("2026-09-17");
    // a replay must never open a live socket
    expect(params.get("autoconnect")).toBeNull();
  });

  test("replay only reloads when Load is clicked, not while typing", async () => {
    mockJournalFiles.mockResolvedValue([
      { file: "RELIANCE_2026-09-17.jsonl", day: "2026-09-17", symbol: "RELIANCE", broker: "fyers_tbt", bytes: 1, modified: 1 },
    ]);

    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("orderflow-iframe");
    await user.click(within(screen.getByTestId("orderflow-mode")).getByRole("button", { name: "Replay" }));
    await screen.findByTestId("orderflow-replay-row");

    // Regression: these inputs used to sit in the iframe-src dependencies, so
    // every keystroke navigated the iframe and fired a load for a half-typed
    // time ("1", "15") that the API rejects.
    await user.type(screen.getByTestId("orderflow-replay-from"), "09:15");
    await user.type(screen.getByTestId("orderflow-replay-to"), "15:15");

    let params = await iframeParams();
    expect(params.get("start")).toBeNull();
    expect(params.get("end")).toBeNull();

    await user.click(screen.getByTestId("orderflow-replay-load"));

    await waitFor(async () => {
      params = await iframeParams();
      expect(params.get("start")).toBe("09:15");
      expect(params.get("end")).toBe("15:15");
    });
  });

  test("accepts loose time formats and normalises them", async () => {
    mockJournalFiles.mockResolvedValue([
      { file: "RELIANCE_2026-09-17.jsonl", day: "2026-09-17", symbol: "RELIANCE", broker: "fyers_tbt", bytes: 1, modified: 1 },
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("orderflow-iframe");
    await user.click(within(screen.getByTestId("orderflow-mode")).getByRole("button", { name: "Replay" }));
    await screen.findByTestId("orderflow-replay-row");

    await user.type(screen.getByTestId("orderflow-replay-from"), "915");     // -> 09:15
    await user.type(screen.getByTestId("orderflow-replay-to"), "9.5");       // -> 09:05
    // 9.5 is earlier than 09:15, so this is a range error, not a load
    await user.click(screen.getByTestId("orderflow-replay-load"));
    expect(await screen.findByTestId("orderflow-replay-error")).toHaveTextContent("earlier than To");

    await user.clear(screen.getByTestId("orderflow-replay-to"));
    await user.type(screen.getByTestId("orderflow-replay-to"), "1505");      // -> 15:05
    await user.click(screen.getByTestId("orderflow-replay-load"));

    await waitFor(async () => {
      const params = await iframeParams();
      expect(params.get("start")).toBe("09:15");
      expect(params.get("end")).toBe("15:05");
    });
  });

  test("rejects an unparseable time instead of sending it to the API", async () => {
    mockJournalFiles.mockResolvedValue([
      { file: "RELIANCE_2026-09-17.jsonl", day: "2026-09-17", symbol: "RELIANCE", broker: "fyers_tbt", bytes: 1, modified: 1 },
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("orderflow-iframe");
    await user.click(within(screen.getByTestId("orderflow-mode")).getByRole("button", { name: "Replay" }));
    await screen.findByTestId("orderflow-replay-row");

    await user.type(screen.getByTestId("orderflow-replay-from"), "abc");
    await user.click(screen.getByTestId("orderflow-replay-load"));

    expect(await screen.findByTestId("orderflow-replay-error")).toHaveTextContent("must be HH:MM");
    const params = await iframeParams();
    expect(params.get("start")).toBeNull();
  });

  test("surfaces a journal listing failure", async () => {
    mockJournalFiles.mockRejectedValue(new Error("journal listing failed"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await user.click(within(screen.getByTestId("orderflow-mode")).getByRole("button", { name: "Replay" }));
    expect(await screen.findByTestId("orderflow-replay-error")).toHaveTextContent("journal listing failed");
  });

  test("live modes do not fetch the journal", async () => {
    renderPage();
    await screen.findByTestId("orderflow-iframe");
    expect(mockJournalFiles).not.toHaveBeenCalled();
  });
});
