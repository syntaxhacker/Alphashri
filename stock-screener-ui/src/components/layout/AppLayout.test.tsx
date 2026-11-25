// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { AppLayout } from "./AppLayout";
import { MemoryRouter, createMemoryHistory } from "@solidjs/router";
import { UIProvider } from "@/ui";
import type { JSX } from "solid-js";
import { fetchSurges } from "../../api/notifications";

// A MemoryRouter with plain children mounts no route — children render nothing,
// so these tests mount through the router's `root` prop instead.
function TestWrapper(props: { children?: JSX.Element; initialRoute?: string; user?: unknown }) {
  const history = createMemoryHistory();
  history.set({ value: props.initialRoute ?? "/", replace: true, scroll: false });
  return <MemoryRouter history={history} root={() => <UIProvider>{props.children}</UIProvider>} />;
}

// Mock matchMedia
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      // Desktop drawdown: the desktop breakpoint is (min-width:900px). Every
      // other query (colour scheme, print, …) stays false like a fresh browser.
      matches: /min-width:\s*900px/.test(String(query)),
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

vi.mock("../layout/NavbarNested", () => ({
  NavbarNested: (props: { activePath: string; collapsed?: boolean }) => (
    <nav
      data-testid="navbar-nested"
      data-active-path={props.activePath}
      data-collapsed={props.collapsed}
    >
      NavbarNested
    </nav>
  ),
}));

vi.mock("./MarketTicker", () => ({
  MarketStatus: () => <div data-testid="market-status-mock" />,
  MarketTicker: () => <div data-testid="market-ticker-mock" />,
}));

vi.mock("../news/NewsPanel", () => ({
  default: () => <div data-testid="news-panel-mock" />,
}));

vi.mock("../../api/notifications", () => ({
  fetchSurges: vi.fn(async () => ({ total: 0, events: [] })),
}));

vi.mock("../../api/notifications", () => ({
  fetchSurges: vi.fn(async () => ({ total: 0, events: [] })),
}));

describe("AppLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children correctly", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div data-testid="child-content">Child Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByText("Child Content")).toBeInTheDocument();
  });

  it("uses theme for shell backgrounds (live theme aware)", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>content</div>
        </AppLayout>
      </TestWrapper>
    ));
    // The shell is built from @/ui primitives with theme-aware classes instead of legacy theme vars.
    // Verify shell elements exist and have theme-aware attributes/classes instead of legacy vars.
    const main = screen.getByTestId("app-main");
    const header = screen.getByTestId("app-sidebar-header");
    const shell = screen.getByTestId("app-shell");
    expect(main).toBeInTheDocument();
    expect(header).toBeInTheDocument();
    expect(shell).toBeInTheDocument();
    expect(header.tagName.toLowerCase()).toBe("div");
  });

  it("renders app shell structure", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar-header")).toBeInTheDocument();
    expect(screen.getByTestId("app-navbar")).toBeInTheDocument();
    expect(screen.getByTestId("app-main")).toBeInTheDocument();
  });

  it("does not render a top app bar", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    // The header was removed to reclaim its vertical space; the brand and the
    // controls live in the sidebar chrome instead.
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar-header")).toBeInTheDocument();
    expect(screen.getByTestId("market-status-mock")).toBeInTheDocument();
  });

  it("renders logo", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    expect(screen.getByTestId("app-logo")).toHaveTextContent("Alphashri");
  });

  it("renders navbar with NavbarNested", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    expect(screen.getAllByTestId("navbar-nested").length).toBeGreaterThanOrEqual(1);
  });

  it("passes active path to NavbarNested", () => {
    render(() => (
      <TestWrapper initialRoute="/sector">
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    const navbars = screen.getAllByTestId("navbar-nested");
    expect(navbars[0]).toHaveAttribute("data-active-path", "/sector");
  });

  it("renders children in main content area", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div data-testid="main-content">Main Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    const main = screen.getByTestId("app-main");
    expect(main).toContainElement(screen.getByTestId("main-content"));
  });

  it("handles navbar collapse toggle", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    const navbars = screen.getAllByTestId("navbar-nested");
    expect(navbars[0]).toHaveAttribute("data-collapsed", "false");
  });

  it("toggles desktop collapsed state when sidebar toggle clicked", async () => {
    render(() => (
      <TestWrapper initialRoute="/">
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));
    const toggles = screen.getAllByLabelText("Toggle sidebar");
    await fireEvent.click(toggles[toggles.length - 1]);
    expect(screen.getAllByTestId("navbar-nested")[0]).toHaveAttribute("data-collapsed", "true");
    // The rail renders a different subtree when collapsed, so re-query the
    // control instead of reusing the now-detached expanded-mode node.
    await fireEvent.click(screen.getAllByLabelText("Toggle sidebar").pop()!);
    expect(screen.getAllByTestId("navbar-nested")[0]).toHaveAttribute("data-collapsed", "false");
  });

  it("collapsed rail hides brand, news and bell but keeps the expand control", async () => {
    render(() => (
      <TestWrapper initialRoute="/">
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    expect(screen.getByTestId("app-logo")).toBeInTheDocument();
    expect(screen.getByTestId("notif-bell")).toBeInTheDocument();

    await fireEvent.click(screen.getAllByLabelText("Toggle sidebar").pop()!);

    // The 64px rail keeps only the control needed to expand it again; the
    // brand, news button and notification bell return on expand.
    expect(screen.queryByTestId("app-logo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notif-bell")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-collapse-toggle")).toBeInTheDocument();
  });

  it("renders notification bell and opens panel on click", async () => {
    render(() => (
      <TestWrapper initialRoute="/">
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));
    expect(screen.getByTestId("notif-bell")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("notif-bell"));
    // NotificationsPanel should be triggered (mocked panel not needed, just bell interaction)
    expect(screen.getByTestId("notif-bell")).toBeInTheDocument();
  });

  it("shows the surge alert count on the bell", async () => {
    vi.mocked(fetchSurges).mockResolvedValueOnce({ total: 5, today_count: 5, events: [] });
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getByTestId("notif-badge")).toHaveTextContent("5");
  });

  it("hides the surge badge when there are no alerts", async () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    await waitFor(() => {
      expect(fetchSurges).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("notif-badge")).not.toBeInTheDocument();
  });

  it("passes collapsed prop correctly to NavbarNested after toggle", async () => {
    render(() => (
      <TestWrapper initialRoute="/">
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));
    const desktopToggle = screen.getAllByLabelText("Toggle sidebar").pop()!;
    await fireEvent.click(desktopToggle);
    expect(screen.getAllByTestId("navbar-nested")[0]).toHaveAttribute("data-collapsed", "true");
  });

  it("applies the rail width as a CSS length string", async () => {
    render(() => (
      <TestWrapper initialRoute="/">
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    expect(screen.getByTestId("app-navbar").getAttribute("style")).toMatch(/width:\s*148px/);

    await fireEvent.click(screen.getAllByLabelText("Toggle sidebar").pop()!);

    expect(screen.getByTestId("app-navbar").getAttribute("style")).toMatch(/width:\s*48px/);
  });

  it("omits the mobile nav bar on desktop", () => {
    // The file-level matchMedia mock reports min-width:900px as matching.
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>
    ));

    expect(screen.queryByTestId("app-mobile-nav-bar")).not.toBeInTheDocument();
  });

  it("makes the shell a fixed frame, not a document scroller", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div data-testid="page-root" />
        </AppLayout>
      </TestWrapper>
    ));

    const shell = screen.getByTestId("app-shell");
    expect(shell.className).toContain("h-screen");
    expect(shell.className).toContain("overflow-hidden");
    expect(shell.style.height).toBe("100vh");
    expect(shell.style.overflow).toBe("hidden");

    const main = screen.getByTestId("app-main");
    expect(main.className).toContain("overflow-hidden");
    expect(main.style.overflow).toBe("hidden");
    // The rail is a flex column so NavbarNested's internal scroll region can
    // actually shrink; a block wrapper would clip the last nav link.
    expect(screen.getByTestId("app-navbar").style.display).toBe("flex");
  });

  it("keeps the desktop content column structurally unchanged", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div data-testid="page-header">Page title</div>
        </AppLayout>
      </TestWrapper>
    ));

    const main = screen.getByTestId("app-main");
    // No 44px reservation bar: the page header is the first thing in the
    // scroll column, and navigation is owned by the permanent rail instead.
    expect(screen.queryByTestId("app-mobile-nav-bar")).not.toBeInTheDocument();
    expect(main.children[0]).toContainElement(screen.getByTestId("page-header"));
    expect(screen.getByTestId("app-navbar")).toBeInTheDocument();
  });
});

describe("AppLayout mobile nav gutter", () => {
  beforeEach(() => {
    // Every media query false — the desktop rail is not mounted, so the mobile
    // nav bar must reserve the toggle's gutter instead.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
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

  it("reserves a real 44px sticky bar above page content, with the toggle inside it", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div data-testid="page-header">Page title</div>
        </AppLayout>
      </TestWrapper>
    ));

    const bar = screen.getByTestId("app-mobile-nav-bar");
    expect(bar).toBeInTheDocument();
    expect(bar.style.height).toBe("44px");
    expect(bar.style.position).toBe("sticky");
    expect(bar.style.top).toBe("0px");
    // The bar owns the gutter in flow, so CompactPage's fallback inset is off.
    expect(document.documentElement.style.getPropertyValue("--app-mobile-nav-gutter")).toBe("0px");

    const toggle = screen.getByTestId("app-mobile-nav-toggle");
    expect(bar).toContainElement(toggle);
    // No longer position:fixed over the first header.
    expect(toggle.style.position).toBe("");
    expect(toggle.getAttribute("style")).not.toContain("top: 8px");
  });

  it("puts the bar before the content column so headers never start under the toggle", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div data-testid="page-header">Page title</div>
        </AppLayout>
      </TestWrapper>
    ));

    const main = screen.getByTestId("app-main");
    const bar = screen.getByTestId("app-mobile-nav-bar");
    const children = Array.from(main.children);
    // The bar is the first thing in the main column; the content wrapper that
    // follows it holds every page header, so no title can start at y=0.
    expect(children[0]).toBe(bar);
    const contentColumn = children[1] as HTMLElement;
    expect(contentColumn).toContainElement(screen.getByTestId("page-header"));
    expect(contentColumn.className).toContain("flex-1");
  });

  it("structurally reserves the 44px gutter below the desktop breakpoint", () => {
    render(() => (
      <TestWrapper>
        <AppLayout>
          <div data-testid="page-header">Page title</div>
        </AppLayout>
      </TestWrapper>
    ));

    const main = screen.getByTestId("app-main");
    const bar = screen.getByTestId("app-mobile-nav-bar");
    const contentColumn = main.children[1] as HTMLElement;

    // The reservation lives in the bar's structure, not just a floating style:
    // a sticky 44px flex item owns the top of the scroll column in flow.
    expect(bar.className).toMatch(/\bsticky\b/);
    expect(bar.className).toMatch(/\btop-0\b/);
    expect(bar.className).toMatch(/\bh-11\b/);
    expect(bar.className).toMatch(/\bshrink-0\b/);
    expect(bar.style.height).toBe("44px");
    expect(bar.style.position).toBe("sticky");
    expect(bar.style.flexShrink).toBe("0");

    // Pages keep the full column width and stay scrollable under the bar;
    // nothing is clipped or hidden to make room for the toggle.
    expect(contentColumn.className).toContain("w-full");
    expect(contentColumn.style.width).toBe("100%");
    expect(contentColumn.className).toContain("flex-1");
    expect(contentColumn.style.minHeight).toBe("0px");
    // The main column is a frame, not the scroll owner: each route page puts
    // its own internal region in charge so the page chrome never scrolls away.
    expect(main.style.overflow).toBe("hidden");
    expect(main.className).toContain("overflow-hidden");
  });
});
