// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.setConfig({ testTimeout: 15000 });
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, createMemoryHistory, Route } from "@solidjs/router";
import { StrategiesContainer } from "./StrategiesContainer";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// We mock the hook to control states; the real StrategiesPage is not mocked
const mockStrategiesState = vi.fn();

// @tabler/icons-react ships React memo() components — they are objects, not
// functions, so Solid createComponent throws on them. Stub with inline SVGs.
vi.mock("@tabler/icons-react", () => ({
  IconAlertCircle: (props: Record<string, unknown>) => <svg data-testid="icon-alert-circle" aria-hidden {...props} />,
  IconRefresh: (props: Record<string, unknown>) => <svg data-testid="icon-refresh" aria-hidden {...props} />,
}));

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

// The @/ui layout stubs render intrinsic elements so this test
// exercises the page wiring, not the theme runtime.
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

// src/components/strategies/{TemplateTreeView,PerformanceView} still render
// through React hooks, which cannot run inside a Solid tree. Stub them with
// the minimal contract the page depends on.
vi.mock("../../components/strategies/TemplateTreeView", () => ({
  TemplateTreeView: (props: Record<string, any>) => {
    const hasContent =
      (Array.isArray(props.strategies) && props.strategies.length > 0) ||
      (Array.isArray(props.templates) && props.templates.length > 0);
    return (
      <div data-testid="template-tree-view">
        {hasContent ? null : <div data-testid="template-tree-empty" />}
      </div>
    );
  },
}));

vi.mock("../../components/strategies/PerformanceView", () => ({
  PerformanceView: (props: Record<string, any>) => {
    const hasContent = Array.isArray(props.performance) && props.performance.length > 0;
    return (
      <div data-testid="performance-view">
        {hasContent ? null : <div data-testid="performance-empty-state" />}
      </div>
    );
  },
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
  const history = createMemoryHistory();
  history.set({ value: "/strategies", replace: true });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/strategies" component={StrategiesContainer} />
    </MemoryRouter>
  ));
}

beforeEach(() => {
  setupBrowserMocks();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("StrategiesContainer route", () => {
  it("renders /strategies without crash (MemoryRouter)", () => {
    renderStrategiesRoute();
    expect(screen.getByTestId("strategies-view")).toBeInTheDocument();
  });

  it("renders strategies-view container", () => {
    renderStrategiesRoute();
    const container = screen.getByTestId("strategies-view");
    expect(container).toHaveClass("strategies-page");
    expect(screen.getByTestId("strategies-nav")).toBeInTheDocument();
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
