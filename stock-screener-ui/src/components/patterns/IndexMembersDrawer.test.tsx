// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
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

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("IndexMembersDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchIndexMembers.mockResolvedValue(MEMBERS);
  });
  afterEach(() => cleanup());

  test("renders the member table and links", async () => {
    r(<IndexMembersDrawer open indexId="NIFTY" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("index-member-row-RELIANCE")).toBeInTheDocument());
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
    const user = userEvent.setup();
    r(<IndexMembersDrawer open indexId="NIFTY" onClose={vi.fn()} />);
    await screen.findByTestId("index-member-row-RELIANCE");
    await user.type(screen.getByTestId("index-members-search"), "TCS");
    expect(screen.getByTestId("index-member-row-TCS")).toBeInTheDocument();
    expect(screen.queryByTestId("index-member-row-RELIANCE")).not.toBeInTheDocument();
  });

  test("scan members passes the filtered symbols and closes", async () => {
    const onScan = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    r(
      <IndexMembersDrawer
        open
        indexId="NIFTY"
        onClose={onClose}
        onScanMembers={onScan}
      />,
    );
    await screen.findByTestId("index-member-row-RELIANCE");
    await user.click(screen.getByTestId("index-members-scan"));
    expect(onScan).toHaveBeenCalledWith(["RELIANCE", "TCS", "INFY"]);
    expect(onClose).toHaveBeenCalled();
  });

  test("shows an error when the index has no members", async () => {
    fetchIndexMembers.mockRejectedValue(new Error("Constituents are not available for 'NIFTYIT'"));
    r(<IndexMembersDrawer open indexId="NIFTYIT" onClose={vi.fn()} />);
    expect(await screen.findByTestId("index-members-error")).toHaveTextContent(
      "Constituents are not available",
    );
  });
});
