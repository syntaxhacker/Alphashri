// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppLayout } from "./AppLayout";
import { TestWrapper } from "../../test-utils/testUtils";

// Mock matchMedia
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
});

// Mock child components
vi.mock("../layout/MarketTicker", () => ({
  MarketTicker: () => <div data-testid="market-ticker">MarketTicker</div>,
}));

vi.mock("../layout/NavbarNested", () => ({
  NavbarNested: ({ activePath, collapsed }: { activePath: string; collapsed?: boolean }) => (
    <nav data-testid="navbar-nested" data-active-path={activePath} data-collapsed={collapsed}>
      NavbarNested
    </nav>
  ),
}));

vi.mock("../news/NewsPanel2", () => ({
  default: () => <div data-testid="news-panel">NewsPanel2</div>,
}));

describe("AppLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children correctly", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div data-testid="child-content">Child Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByText("Child Content")).toBeInTheDocument();
  });

  it("uses theme CSS variables for shell backgrounds (live theme aware)", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>content</div>
        </AppLayout>
      </TestWrapper>,
    );
    const main = document.querySelector("[data-testid='app-main']")!;
    const header = document.querySelector("[data-testid='app-header']")!;
    // Mantine AppShell converts bg/c props into inline CSS with the var value.
    expect(main.getAttribute("style") || "").toContain("var(--mantine-color-body)");
    expect(header.getAttribute("style") || "").toContain("var(--mantine-color-body)");
  });

  it("renders app shell structure", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(screen.getByTestId("app-navbar")).toBeInTheDocument();
    expect(screen.getByTestId("app-main")).toBeInTheDocument();
  });

  it("renders logo", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("app-logo")).toHaveTextContent("Alphashri");
  });

  it("renders market ticker in header", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("market-ticker")).toBeInTheDocument();
  });

  it("renders news panel in header", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("news-panel")).toBeInTheDocument();
  });

  it("renders navbar with NavbarNested", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("navbar-nested")).toBeInTheDocument();
  });

  it("passes active path to NavbarNested", () => {
    render(
      <TestWrapper initialRoute="/sector">
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    const navbar = screen.getByTestId("navbar-nested");
    expect(navbar).toHaveAttribute("data-active-path", "/sector");
  });

  it("renders children in main content area", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div data-testid="main-content">Main Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    const main = screen.getByTestId("app-main");
    expect(main).toContainElement(screen.getByTestId("main-content"));
  });

  it("handles navbar collapse toggle", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    const navbar = screen.getByTestId("navbar-nested");
    expect(navbar).toHaveAttribute("data-collapsed", "false");
  });
});
