// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import { muiTheme } from "@/ui/muiTheme";
import { StrategiesContainer } from "./StrategiesContainer";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// We mock the hook to control states; but render real StrategiesPage (not mocked)
const mockStrategiesState = vi.fn();

vi.mock("../../hooks/useStrategiesState", () => ({
  useStrategiesState: (...args: unknown[]) => mockStrategiesState(...args),
}));

vi.mock("../../state/strategies", () => ({
  initStrategiesState: vi.fn(),
  getStrategiesState: vi.fn(() => ({ strategies: [], templates: [], isLoading: false, error: null })),
  getCurrentView: vi.fn(() => "tree"),
  subscribe: vi.fn(() => () => {}),
  loadTemplates: vi.fn(),
  loadStrategies: vi.fn(),
}));

vi.mock("../../api/symbols", () => ({
  searchSymbols: vi.fn(() => Promise.resolve([])),
}));

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    strategies: [],
    templates: [],
    performance: [],
    bots: [],
    isLoading: false,
    error: null,
    activeView: "tree" as const,
    showCreateModal: false,
    showEditModal: false,
    editingStrategy: null,
    parentTemplate: null,
    onViewChange: vi.fn(),
    onCreateStrategy: vi.fn(),
    onEditStrategy: vi.fn(),
    onDeleteStrategy: vi.fn(),
    onOpenCreateModal: vi.fn(),
    onOpenEditModal: vi.fn(),
    onCloseCreateModal: vi.fn(),
    onCloseEditModal: vi.fn(),
    onCreateFromTemplate: vi.fn(),
    onEditTemplate: vi.fn(),
    onSyncVariations: vi.fn(),
    onSelectStrategy: vi.fn(),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn(),
    onClearError: vi.fn(),
    isAnyBotRunning: false,
    ...overrides,
  };
}

function renderStrategiesRoute(propsOverrides: Record<string, unknown> = {}) {
  mockStrategiesState.mockReturnValue(baseProps(propsOverrides));
  return render(
    <ThemeProvider theme={muiTheme}>
      <MemoryRouter initialEntries={["/strategies"]}>
        <StrategiesContainer />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  setupBrowserMocks();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StrategiesContainer route", () => {
  it("renders /strategies without crash (ThemeProvider + MemoryRouter)", () => {
    renderStrategiesRoute();
    expect(screen.getByTestId("strategies-view")).toBeInTheDocument();
  });

  it("renders strategies-view container", () => {
    renderStrategiesRoute();
    const container = screen.getByTestId("strategies-view");
    expect(container).toHaveClass("strategies-page");
    expect(screen.getByTestId("strategies-nav-container")).toBeInTheDocument();
    expect(screen.getByTestId("strategies-content")).toBeInTheDocument();
  });

  it("handles empty state (no strategies, not loading, no error)", () => {
    renderStrategiesRoute({ strategies: [], templates: [], isLoading: false, error: null });
    // empty tree view renders placeholder from TemplateTreeView
    expect(screen.getByTestId("template-tree-empty")).toBeInTheDocument();
  });

  it("handles loading state", () => {
    renderStrategiesRoute({ isLoading: true });
    // StrategiesPage passes isLoading to TemplateTreeView; check loading indicator or skeleton
    // At minimum container should still render without crash
    expect(screen.getByTestId("strategies-view")).toBeInTheDocument();
    // TemplateTreeView with isLoading true should not show error
    expect(screen.queryByTestId("strategies-error")).not.toBeInTheDocument();
  });

  it("handles error state", () => {
    renderStrategiesRoute({ error: "Failed to load" });
    expect(screen.getByTestId("strategies-error")).toBeInTheDocument();
    expect(screen.getByText("Strategies failed to load")).toBeInTheDocument();
    expect(screen.getByTestId("strategies-retry-btn")).toBeInTheDocument();
    expect(screen.getByTestId("strategies-dismiss-btn")).toBeInTheDocument();
  });

  it("renders performance view when activeView is performance", () => {
    renderStrategiesRoute({ activeView: "performance" });
    expect(screen.getByTestId("performance-empty-state")).toBeInTheDocument();
  });
});
