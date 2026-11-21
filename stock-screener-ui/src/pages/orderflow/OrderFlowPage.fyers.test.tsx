// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router";
import { OrderFlowPage } from "./OrderFlowPage";
import { getBrokerStatus } from "@/api/brokers";
import { getExpiries, getFyersSymbol, getOptionChain, getUnderlyings } from "@/api/upstoxOptions";

vi.mock("@/api/brokers", () => ({
  getBrokerStatus: vi.fn(),
  connectUpstox: vi.fn(),
}));

vi.mock("@/api/orderflowJournal", () => ({
  listJournalFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/api/upstoxOptions", () => ({
  getUnderlyings: vi.fn(),
  getExpiries: vi.fn(),
  getOptionChain: vi.fn(),
  getFyersSymbol: vi.fn(),
}));

// The @/ui Box/Flex/... stubs from src/pages/solidTestStubs.tsx render as
// intrinsic elements; page tests exercise page wiring, not the theme runtime.
// Popover is stubbed with a bare pass-through; no OrderFlow test opens the
// View dropdown.
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  const actual = await importOriginal<Record<string, unknown>>();
  const stubbed = await uiLayoutStub(actual);
  const passthrough = (props: any) => <div>{props.children}</div>;
  return {
    ...stubbed,
    Popover: (props: any) => <div data-testid="orderflow-view-popover">{props.children}</div>,
    PopoverTarget: passthrough,
    PopoverDropdown: passthrough,
  };
});

const mockStatus = vi.mocked(getBrokerStatus);
const mockUnderlyings = vi.mocked(getUnderlyings);
const mockExpiries = vi.mocked(getExpiries);
const mockOptionChain = vi.mocked(getOptionChain);
const mockFyersSymbol = vi.mocked(getFyersSymbol);

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
  mockFyersSymbol.mockResolvedValue({
    symbol: "NSE:NIFTY26SEP23400CE",
    fyToken: 12345,
    oi: 1000,
    oich: 50,
  });
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

function renderPage(initialEntry = "/orderflow") {
  const history = createMemoryHistory();
  history.set({ value: initialEntry, replace: true });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/orderflow" component={OrderFlowPage} />
      <Route path="/settings" component={() => <div data-testid="settings-route" />} />
    </MemoryRouter>
  ));
}

async function switchToOptions() {
  fireEvent.click(within(screen.getByTestId("orderflow-mode")).getByRole("button", { name: "Options" }));
}

async function waitForChain() {
  await waitFor(() => expect(mockOptionChain).toHaveBeenCalledWith("NIFTY", "2026-09-18"));
  await waitFor(() =>
    expect(within(screen.getByTestId("orderflow-strike")).getByText("105")).toBeInTheDocument(),
  );
}

describe("OrderFlowPage Options mode per-broker symbol", () => {
  test("fyers_tbt broker streams the resolved Fyers symbol, not the Upstox key", async () => {
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await switchToOptions();
    await waitForChain();

    // Default broker is fyers_tbt.
    expect((await iframeParams()).get("broker")).toBe("fyers_tbt");

    fireEvent.click(screen.getByTestId("orderflow-use-contract"));

    await waitFor(() =>
      expect(mockFyersSymbol).toHaveBeenCalledWith("NIFTY", "2026-09-18", 105, "CE"),
    );
    const params = await iframeParams();
    expect(params.get("symbol")).toBe("NSE:NIFTY26SEP23400CE");
    expect(params.get("tick")).toBe("0.05");
  });

  test("plain fyers broker also resolves via the Fyers endpoint", async () => {
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await switchToOptions();
    await waitForChain();

    fireEvent.input(within(screen.getByTestId("orderflow-broker")).getByRole("combobox"), { target: { value: "fyers" } });
    fireEvent.click(screen.getByTestId("orderflow-use-contract"));

    await waitFor(() => expect(mockFyersSymbol).toHaveBeenCalled());
    expect((await iframeParams()).get("symbol")).toBe("NSE:NIFTY26SEP23400CE");
  });

  test("upstox broker keeps the Upstox instrument key without resolving", async () => {
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await switchToOptions();
    await waitForChain();

    fireEvent.input(within(screen.getByTestId("orderflow-broker")).getByRole("combobox"), { target: { value: "upstox" } });
    fireEvent.click(screen.getByTestId("orderflow-use-contract"));

    const params = await iframeParams();
    expect(params.get("symbol")).toBe("NSE_FO|CE|105");
    expect(mockFyersSymbol).not.toHaveBeenCalled();
  });

  test("resolver failure shows a visible error and keeps the old symbol", async () => {
    mockFyersSymbol.mockRejectedValue(new Error("not found"));
    renderPage();
    await screen.findByTestId("orderflow-iframe");

    await switchToOptions();
    await waitForChain();

    fireEvent.click(screen.getByTestId("orderflow-use-contract"));

    const error = await screen.findByTestId("orderflow-options-error");
    expect(error).toHaveTextContent(/Could not find NIFTY 105 CE @ 2026-09-18 on Fyers/);
    expect(error).toHaveTextContent(/switch the broker to Upstox/);
    // The dead feed is never connected: the previous symbol stays active.
    expect((await iframeParams()).get("symbol")).toBe("RELIANCE");
  });
});
