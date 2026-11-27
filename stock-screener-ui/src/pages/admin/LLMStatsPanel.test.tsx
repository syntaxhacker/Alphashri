// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { LLMStatsPanel } from "./LLMStatsPanel";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const { mockFetchWithAuth } = vi.hoisted(() => ({ mockFetchWithAuth: vi.fn() }));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({ fetchWithAuth: mockFetchWithAuth }),
}));

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { uiLayoutStub } = await import("../../pages/solidTestStubs");
  return uiLayoutStub(actual);
});

vi.mock("../../components/common/compact", () => ({
  CompactPanel: (props: any) => (
    <section data-testid="compact-panel" data-description={props.description ?? ""}>
      {props.children}
    </section>
  ),
  CompactStat: (props: any) => (
    <div>
      {props.label}: {props.value}
    </div>
  ),
  CompactStatGrid: (props: any) => <div>{props.children}</div>,
}));

vi.mock("../../components/common/TanStackTable", () => ({
  TanStackTable: (props: any) => (
    <div data-testid="runs-table">
      {props.data.length === 0 ? props.emptyMessage : `${props.data.length} runs`}
    </div>
  ),
}));

describe("LLMStatsPanel empty runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        aggregate: {
          total_runs: 0,
          total_tokens: 0,
          total_cost_usd: 0,
          avg_response_time_ms: 0,
          models_used: [],
        },
        recent_runs: [],
      }),
    });
  });

  afterEach(() => cleanup());

  it("states emptiness once, in the table body, not in the panel caption too", async () => {
    render(() => <LLMStatsPanel />);

    await waitFor(() => expect(screen.getByTestId("admin-llm-panel")).toBeInTheDocument());

    expect(screen.getAllByText("No recent runs")).toHaveLength(1);
    expect(screen.getByTestId("compact-panel").getAttribute("data-description")).toBe("");
  });
});
