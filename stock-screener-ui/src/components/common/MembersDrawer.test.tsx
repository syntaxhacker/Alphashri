// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { MembersDrawer, type MembersDrawerProps } from "./MembersDrawer";

const ids = {
  drawer: "members-drawer",
  close: "members-close",
  search: "members-search",
  error: "members-error",
  row: (symbol: string) => `member-row-${symbol}`,
  tv: (symbol: string) => `member-tv-${symbol}`,
  chart: (symbol: string) => `member-chart-${symbol}`,
};

function props(overrides: Partial<MembersDrawerProps> = {}): MembersDrawerProps {
  return {
    open: true,
    onClose: vi.fn(),
    title: "NIFTY 50",
    subtitle: "50 constituents",
    description: "Constituents of the NIFTY 50 index",
    symbols: ["RELIANCE", "TCS"],
    loading: false,
    error: null,
    query: "",
    onQueryChange: vi.fn(),
    searchPlaceholder: "Filter symbols",
    closeLabel: "Close members drawer",
    ids,
    width: 420,
    gridMin: 120,
    ...overrides,
  };
}

describe("MembersDrawer", () => {
  test("mounts only while open and exposes the header copy and a labelled close control", () => {
    const closed = props({ open: false });
    const hidden = renderWithProviders(() => <MembersDrawer {...closed} />);
    expect(hidden.queryByTestId(ids.drawer)).not.toBeInTheDocument();
    hidden.unmount();

    const onClose = vi.fn();
    renderWithProviders(() => <MembersDrawer {...props({ onClose })} />);

    const drawer = screen.getByTestId(ids.drawer);
    expect(drawer).toHaveTextContent("NIFTY 50");
    expect(drawer).toHaveTextContent("50 constituents");
    expect(drawer).toHaveTextContent("Constituents of the NIFTY 50 index");
    expect(screen.getByTestId(`${ids.drawer}-header`)).toBeInTheDocument();

    const close = screen.getByTestId(ids.close);
    expect(close).toHaveAccessibleName("Close members drawer");
    expect(close.tagName).toBe("BUTTON");
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("renders one row per symbol with a TradingView link and an in-app chart link", () => {
    renderWithProviders(() => <MembersDrawer {...props()} />);

    expect(screen.getByTestId(ids.row("RELIANCE"))).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId(ids.row("TCS"))).toHaveTextContent("TCS");
    expect(screen.getByTestId(ids.tv("RELIANCE"))).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    const chart = screen.getByTestId(ids.chart("TCS"));
    expect(chart).toHaveAttribute("href", "/chart/TCS");
    expect(chart).toHaveAttribute("title", "Open TCS chart");
    expect(chart).toHaveAccessibleName("Open TCS chart");
    chart.focus();
    expect(document.activeElement).toBe(chart);
  });

  test("uses the caller's grid width and prints both footer slots", () => {
    renderWithProviders(() =>
      <MembersDrawer
        {...props({
          gridMin: 180,
          gridGap: "6px",
          footerLeft: <span data-testid="footer-left">Showing 2</span>,
          footerRight: <button data-testid="footer-right">Scan</button>,
        })}
      />,
    );

    const grid = screen.getByTestId(ids.row("RELIANCE")).parentElement as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain("180px");
    expect(grid.style.gap).toBe("6px");
    expect(screen.getByTestId("footer-left")).toHaveTextContent("Showing 2");
    expect(screen.getByTestId("footer-right")).toHaveTextContent("Scan");
  });

  test("forwards search edits to the host instead of filtering internally", () => {
    const onQueryChange = vi.fn();
    renderWithProviders(() => <MembersDrawer {...props({ query: "RELI", onQueryChange })} />);

    const input = screen.getByTestId(ids.search);
    expect(input).toHaveAttribute("placeholder", "Filter symbols");
    expect(input).toHaveValue("RELI");
    fireEvent.input(input, { target: { value: "TCS" } });
    expect(onQueryChange).toHaveBeenCalledWith("TCS");
    // The caller owns the filter; the drawer still shows the rows it was given.
    expect(screen.getByTestId(ids.row("RELIANCE"))).toBeInTheDocument();
  });

  test("distinguishes a filtered-empty result, a custom empty note and the default empty state", () => {
    const filtered = props({ symbols: [], query: "NOPE" });
    const first = renderWithProviders(() => <MembersDrawer {...filtered} />);
    expect(screen.getByTestId(ids.drawer)).toHaveTextContent("No matching symbols");
    first.unmount();

    const noted = props({ symbols: [], emptyNote: "No members in this theme" });
    const second = renderWithProviders(() => <MembersDrawer {...noted} />);
    expect(screen.getByTestId(ids.drawer)).toHaveTextContent("No members in this theme");
    second.unmount();

    renderWithProviders(() => <MembersDrawer {...props({ symbols: [] })} />);
    expect(screen.getByTestId(ids.drawer)).toHaveTextContent("No members available");
  });

  test("shows a loader instead of rows while loading, and an alert for the caller's error", () => {
    const loading = renderWithProviders(() =>
      <MembersDrawer {...props({ loading: true, error: "Index service unavailable" })} />,
    );
    expect(screen.getByTestId(ids.drawer)).toHaveTextContent("Loading members…");
    expect(screen.queryByTestId(ids.row("RELIANCE"))).not.toBeInTheDocument();
    const alert = screen.getByTestId(ids.error!);
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("Index service unavailable");
    loading.unmount();

    renderWithProviders(() => <MembersDrawer {...props({ error: null })} />);
    expect(screen.queryByTestId(ids.error!)).not.toBeInTheDocument();
    expect(screen.getByTestId(ids.row("TCS"))).toBeInTheDocument();
  });
});
