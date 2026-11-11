// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SimulatorPanel } from "./SimulatorPanel";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";

vi.mock("../PremiumTracker/PayoffChart", () => ({
  PayoffChart: () => <div data-testid="mock-payoff-chart">mock chart</div>,
}));

vi.mock("@/api/symbols", () => ({
  searchSymbols: vi.fn(async () => []),
}));

const matrix = [
  { strike: 23100, ce: { market_data: { ltp: 200 } }, pe: { market_data: { ltp: 40 } } },
  { strike: 23150, ce: { market_data: { ltp: 95 } }, pe: { market_data: { ltp: 90 } } },
  { strike: 23200, ce: { market_data: { ltp: 40 } }, pe: { market_data: { ltp: 160 } } },
];

function renderPanel() {
  return renderWithProviders(
    <SimulatorPanel
      selectedUnderlying="NIFTY"
      selectedExpiry="25MAY"
      spotPrice={23150}
      strikeMatrix={matrix}
    />,
  );
}

async function pickLoadOption(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  const combo = within(screen.getByTestId("simulator-load-select")).getByRole("combobox");
  await user.click(combo);
  await screen.findByRole("option", { name });
  await user.click(screen.getByRole("option", { name }));
}

describe("SimulatorPanel", () => {
  beforeEach(() => {
    setupBrowserMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the panel with header spot/ATM/DTE", () => {
    renderPanel();
    expect(screen.getByTestId("simulator-panel")).toBeInTheDocument();
    expect(screen.getByText("SIMULATOR")).toBeInTheDocument();
    expect(screen.getByText("Spot 23,150")).toBeInTheDocument();
    expect(screen.getByText("ATM 23150")).toBeInTheDocument();
    expect(screen.getByText(/DTE \d+ days/)).toBeInTheDocument();
  });

  it("uses a single compact underlying search instead of a duplicate select", async () => {
    const user = userEvent.setup();
    const onUnderlyingChange = vi.fn();
    renderWithProviders(
      <SimulatorPanel
        selectedUnderlying="NIFTY"
        selectedExpiry="25MAY"
        spotPrice={23150}
        strikeMatrix={matrix}
        availableUnderlyings={["NIFTY", "BANKNIFTY"]}
        availableExpiries={["25MAY"]}
        onUnderlyingChange={onUnderlyingChange}
        onExpiryChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("simulator-underlying-search")).toBeInTheDocument();
    expect(screen.queryByTestId("simulator-underlying-select")).not.toBeInTheDocument();
    expect(screen.getByTestId("simulator-expiry-select")).toBeInTheDocument();

    const search = screen.getByPlaceholderText("Index or F&O stock");
    await user.clear(search);
    await user.type(search, "BANK");
    await user.click(await screen.findByText("BANKNIFTY"));

    expect(onUnderlyingChange).toHaveBeenCalledWith("BANKNIFTY");
  });

  it("renders BUY and SELL template groups", () => {
    renderPanel();
    expect(screen.getByTestId("simulator-template-long-call")).toBeInTheDocument();
    expect(screen.getByTestId("simulator-template-long-straddle")).toBeInTheDocument();
    expect(screen.getByTestId("simulator-template-bull-call-spread")).toBeInTheDocument();
    expect(screen.getByTestId("simulator-template-bull-put-spread")).toBeInTheDocument();
    expect(screen.getByTestId("simulator-template-bear-call-spread")).toBeInTheDocument();
    expect(screen.getByTestId("simulator-template-iron-condor")).toBeInTheDocument();
  });

  it("selecting a template builds ATM legs with live LTP entries", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("simulator-template-long-call"));
    expect(screen.getAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(1);
    // entry filled from live LTP of 23150 CE (95)
    expect(screen.getByText("Debit ₹95.00")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByTestId("mock-payoff-chart")).toBeInTheDocument();
  });

  it("selecting a sell template shows a net credit", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("simulator-template-bear-call-spread"));
    // BUY 23250 CE (no quote → 0) + SELL 23200 CE (₹40) = net credit ₹40
    expect(screen.getByText("Credit ₹40.00")).toBeInTheDocument();
  });

  it("adds and removes legs", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("simulator-add-leg"));
    expect(screen.getAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(1);
    expect(screen.getByText("Debit ₹95.00")).toBeInTheDocument();

    await user.click(screen.getByTestId("simulator-add-leg"));
    expect(screen.getAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(2);

    const removeButtons = screen.getAllByTitle("Remove leg");
    await user.click(removeButtons[1]);
    expect(screen.getAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(1);

    await user.click(screen.getAllByTitle("Remove leg")[0]);
    expect(screen.queryAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(0);
  });

  it("duplicate creates a copy of a leg", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("simulator-template-long-call"));
    await user.click(screen.getAllByTitle("Duplicate leg")[0]);
    expect(screen.getAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(2);
  });

  it("scenario table shows P&L at −10%..+10% with sign colours", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("simulator-template-long-call"));
    const scenarioRows = screen.getAllByTestId("simulator-scenario-row");
    expect(scenarioRows).toHaveLength(5);
    expect(screen.getByText("-10%")).toBeInTheDocument();
    expect(scenarioRows[2]).toHaveTextContent("Spot");
    expect(screen.getByText("+10%")).toBeInTheDocument();
    // 23150 CE bought at 95: +10% spot (25465) → intrinsic 2315 − 95 = +2220
    expect(screen.getByText("+₹2,220.00")).toBeInTheDocument();
    // three scenarios finish below the breakeven -> -₹95.00 each (+1 in max-loss stat)
    expect(screen.getAllByText("-₹95.00")).toHaveLength(4);
  });

  it("saves to localStorage, loads via Select, and resets", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByTestId("simulator-save")).toBeDisabled();

    await user.click(screen.getByTestId("simulator-template-long-call"));
    await user.click(screen.getByTestId("simulator-add-leg"));
    expect(screen.getAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(2);

    await user.click(screen.getByTestId("simulator-save"));
    expect(localStorage.getItem("options-simulator-saved-v1")).not.toBeNull();
    expect(screen.getByTestId("simulator-load-select")).toBeInTheDocument();

    await pickLoadOption(user, /^Saved \d/);
    // the saved strategy carried both legs
    expect(screen.getAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(2);

    await user.click(screen.getByTestId("simulator-reset"));
    expect(screen.queryAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(0);
  });

  it("does not crash with a null spot", () => {
    renderWithProviders(
      <SimulatorPanel
        selectedUnderlying="NIFTY"
        selectedExpiry="25MAY"
        spotPrice={null}
        strikeMatrix={matrix}
      />,
    );
    expect(screen.getByTestId("simulator-panel")).toBeInTheDocument();
    expect(screen.getByText("ATM 23150")).toBeInTheDocument();
    expect(screen.getByText("Spot —")).toBeInTheDocument();
    expect(screen.getByText(/DTE \d+ days/)).toBeInTheDocument();
  });

  it("treats a zero spot as missing live data", () => {
    renderWithProviders(
      <SimulatorPanel
        selectedUnderlying="NIFTY"
        selectedExpiry="25MAY"
        spotPrice={0}
        strikeMatrix={matrix}
      />,
    );
    expect(screen.getByText("Spot —")).toBeInTheDocument();
    expect(screen.queryByText("Spot 0")).not.toBeInTheDocument();
  });

  it("shows live-chain loading and error states", () => {
    renderWithProviders(
      <SimulatorPanel
        selectedUnderlying="NIFTY"
        selectedExpiry="25MAY"
        spotPrice={23150}
        strikeMatrix={matrix}
        loading
        error="Upstox token expired or invalid"
      />,
    );
    expect(screen.getByText("Loading live chain")).toBeInTheDocument();
    expect(screen.getByText("Upstox token expired or invalid")).toBeInTheDocument();
  });

  it("refuses to build a template before live strikes arrive", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SimulatorPanel
        selectedUnderlying="COCHINSHIP"
        selectedExpiry="2026-11-23"
        spotPrice={null}
        strikeMatrix={[]}
      />,
    );
    await user.click(screen.getByTestId("simulator-template-long-call"));
    expect(screen.queryAllByTestId(/^simulator-leg-\d+$/)).toHaveLength(0);
    expect(screen.getByText(/Waiting for the live option chain/)).toBeInTheDocument();
  });
});
