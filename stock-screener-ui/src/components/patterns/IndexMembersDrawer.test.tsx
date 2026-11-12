// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { IndexMembersDrawer } from "./IndexMembersDrawer";

const fetchIndexMembers = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchIndexMembers: (...args: unknown[]) => fetchIndexMembers(...args),
}));

const MEMBERS = {
  index: "NIFTY",
  label: "NIFTY 50",
  count: 3,
  symbols: ["RELIANCE", "TCS", "INFY"],
};


describe("IndexMembersDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchIndexMembers.mockResolvedValue(MEMBERS);
  });
  afterEach(() => cleanup());

  test("renders the member table and links", async () => {
    render(() => <IndexMembersDrawer open indexId="NIFTY" onClose={vi.fn()} />);
    expect(await screen.findByTestId("index-member-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByText("NIFTY 50 · 3 stocks")).toBeInTheDocument();
    expect(screen.getByTestId("index-member-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("index-member-row-INFY")).toBeInTheDocument();
    expect(screen.getByTestId("index-member-tv-RELIANCE")).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(screen.getByTestId("index-member-chart-TCS")).toHaveAttribute("href", "/chart/TCS");
  });

  test("filters by symbol", async () => {
    render(() => <IndexMembersDrawer open indexId="NIFTY" onClose={vi.fn()} />);
    await screen.findByTestId("index-member-row-RELIANCE");
    fireEvent.input(screen.getByTestId("index-members-search"), { target: { value: "TCS" } });
    expect(screen.getByTestId("index-member-row-TCS")).toBeInTheDocument();
    expect(screen.queryByTestId("index-member-row-RELIANCE")).not.toBeInTheDocument();
  });

  test("scan members passes the filtered symbols and closes", async () => {
    const onScan = vi.fn();
    const onClose = vi.fn();
    render(() =>       <IndexMembersDrawer
        open
        indexId="NIFTY"
        onClose={onClose}
        onScanMembers={onScan}
      />);
    await screen.findByTestId("index-member-row-RELIANCE");
    fireEvent.click(screen.getByTestId("index-members-scan"));
    expect(onScan).toHaveBeenCalledWith(["RELIANCE", "TCS", "INFY"]);
    expect(onClose).toHaveBeenCalled();
  });

  test("shows an error when the index has no members", async () => {
    fetchIndexMembers.mockRejectedValue(new Error("Constituents are not available for 'NIFTYIT'"));
    render(() => <IndexMembersDrawer open indexId="NIFTYIT" onClose={vi.fn()} />);
    expect(await screen.findByTestId("index-members-error")).toHaveTextContent(
      "Constituents are not available",
    );
  });
});
