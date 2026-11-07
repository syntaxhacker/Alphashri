// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { ThemeMembersDrawer } from "./ThemeMembersDrawer";

const { mockFetchThemeDetail } = vi.hoisted(() => ({
  mockFetchThemeDetail: vi.fn(),
}));

vi.mock("../../api/rotation", () => ({
  fetchThemeDetail: (...args: unknown[]) => mockFetchThemeDetail(...args),
}));

function renderDrawer() {
  return render(
    <ThemeMembersDrawer
      open
      slug="defence"
      name="Defence"
      onClose={vi.fn()}
    />,
    { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> },
  );
}

describe("ThemeMembersDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchThemeDetail.mockResolvedValue({
      theme: {
        slug: "defence",
        name: "Defence",
        category: "Industrials",
        description: "Defence and aerospace supply chain",
        member_count: 3,
      },
      constituents: ["HAL", "BEL", "BDL"],
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the theme member grid with TV and chart links", async () => {
    renderDrawer();

    expect(await screen.findByTestId("theme-member-HAL")).toBeInTheDocument();
    expect(screen.getByText("Defence")).toBeInTheDocument();
    expect(screen.getByText(/3 members/)).toBeInTheDocument();
    expect(screen.getByText("Defence and aerospace supply chain")).toBeInTheDocument();
    expect(screen.getByTestId("theme-member-tv-HAL")).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3AHAL",
    );
    expect(screen.getByTestId("theme-member-chart-BEL")).toHaveAttribute("href", "/chart/BEL");
  });

  test("filters the members", async () => {
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByTestId("theme-member-HAL");

    await user.type(screen.getByTestId("theme-members-search"), "BE");
    expect(screen.getByTestId("theme-member-BEL")).toBeInTheDocument();
    expect(screen.queryByTestId("theme-member-HAL")).not.toBeInTheDocument();
  });

  test("shows an error when the theme request fails", async () => {
    mockFetchThemeDetail.mockRejectedValue(new Error("theme down"));
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByText("theme down")).toBeInTheDocument();
    });
  });
});
