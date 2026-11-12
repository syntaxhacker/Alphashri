// @vitest-environment happy-dom
import { Show } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import AdminPage from "./AdminPage";
import { setupBrowserMocks } from "../test-utils/setupBrowser";

// @/ui's dynamic-tag layout primitives crash at runtime on this branch;
// stub them with intrinsic elements (see src/pages/solidTestStubs.tsx).
// @/ui's Tabs is also broken on this branch (calls createSignal without
// importing it → ReferenceError on mount), so provide a minimal faithful
// Tabs mock with the same compound API (Tabs / Tabs.Tab / Tabs.Panel).
vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  const { createSignal, Show } = await import("solid-js");
  const stubbed = await uiLayoutStub(actual);

  let currentTabs: { value: () => string | null | undefined; set: (v: string | null) => void } | null = null;

  const Tabs = (props: any) => {
    const [value, setValue] = createSignal<string | null>(props.defaultValue ?? null);
    currentTabs = { value, set: setValue };
    return <>{props.children}</>;
  };
  const TabsList = (props: any) => (
    <div role="tablist" data-testid={props["data-testid"]} className={props.className}>
      {props.children}
    </div>
  );
  const Tab = (props: any) => (
    <button
      role="tab"
      aria-selected={currentTabs?.value() === props.value}
      data-testid={props["data-testid"]}
      onClick={() => currentTabs?.set(props.value)}
    >
      {props.children}
    </button>
  );
  const Panel = (props: any) => (
    <Show when={currentTabs?.value() === props.value}>
      <div role="tabpanel" data-testid={props["data-testid"]} className={props.className}>
        {props.children}
      </div>
    </Show>
  );

  const TabsMock = Object.assign(Tabs, { List: TabsList, Tab, Panel });

  return { ...stubbed, Tabs: TabsMock };
});

// Mock the admin panel components
vi.mock("./admin/LLMStatsPanel", () => ({
  LLMStatsPanel: () => <div data-testid="llm-stats-panel">LLM Stats Content</div>,
}));

vi.mock("./admin/Admin52wRangePanel", () => ({
  Admin52wRangePanel: () => <div data-testid="admin-52w-range-panel-mock" />,
}));

vi.mock("./admin/NewsQueuePanel", () => ({
  NewsQueuePanel: () => <div data-testid="news-queue-panel-mock" />,
}));

vi.mock("./admin/AdminPatternTimeframesPanel", () => ({
  AdminPatternTimeframesPanel: () => <div data-testid="admin-pattern-timeframes-panel-mock" />,
}));

vi.mock("./admin/OrderFlowJournalPanel", () => ({
  OrderFlowJournalPanel: () => <div data-testid="orderflow-journal-panel-mock" />,
}));

vi.mock("../components/patterns/PatternImageManager", () => ({
  PatternImageManager: () => <div data-testid="pattern-image-manager-mock" />,
}));

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the admin page with tabs", () => {
    render(() => <AdminPage />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("LLM stats")).toBeInTheDocument();
    expect(screen.getByText("52W range batch")).toBeInTheDocument();
    expect(screen.getByText("Pattern timeframes")).toBeInTheDocument();
    expect(screen.getByText("News Queue")).toBeInTheDocument();
  });

  it("shows LLM stats tab by default", () => {
    render(() => <AdminPage />);
    expect(screen.getByTestId("llm-stats-panel")).toBeInTheDocument();
  });

  it("switches to 52W tab", () => {
    render(() => <AdminPage />);
    fireEvent.click(screen.getByTestId("admin-tab-52w"));
    expect(screen.getByTestId("admin-52w-range-panel-mock")).toBeInTheDocument();
  });

  it("switches to News Queue tab", () => {
    render(() => <AdminPage />);
    fireEvent.click(screen.getByTestId("admin-tab-news-queue"));
    expect(screen.getByTestId("news-queue-panel-mock")).toBeInTheDocument();
  });

  it("renders a compact header without a page description", () => {
    render(() => <AdminPage />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByText(/LLM telemetry/)).not.toBeInTheDocument();
  });
});
