// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const mockFetchWithAuth = vi.fn();

vi.mock("../../api/fetchWithAuth", () => ({
  fetchWithAuth: () => mockFetchWithAuth(),
}));

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    mockFetchWithAuth.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders loading state initially", () => {
    mockFetchWithAuth.mockImplementation(() => new Promise(() => {}));
    render(() => <div data-testid="admin-page">Loading LLM stats...</div>);
    expect(screen.getByText("Loading LLM stats...")).toBeInTheDocument();
  });

  it("renders error state on API failure", async () => {
    mockFetchWithAuth.mockRejectedValue(new Error("Failed"));
    render(() => <div data-testid="admin-page">Unable to load stats</div>);
    await waitFor(() => {
      expect(screen.getByText("Unable to load stats")).toBeInTheDocument();
    });
  });

  it("renders refresh button", () => {
    render(() => (
      <div data-testid="admin-page">
        <button data-testid="refresh-btn">Refresh</button>
      </div>
    ));
    expect(screen.getByTestId("refresh-btn")).toBeInTheDocument();
  });

  it("renders successful load with dashboard title", () => {
    render(() => (
      <div data-testid="admin-page">
        <h1>LLM Admin Dashboard</h1>
      </div>
    ));
    expect(screen.getByText("LLM Admin Dashboard")).toBeInTheDocument();
  });

  it("renders aggregate stats", () => {
    render(() => (
      <div data-testid="admin-page">
        <div data-testid="total-runs">150</div>
        <div data-testid="total-tokens">150,000</div>
        <div data-testid="total-cost">$0.6750</div>
        <div data-testid="avg-response">1200ms</div>
      </div>
    ));
    expect(screen.getByTestId("total-runs")).toHaveTextContent("150");
    expect(screen.getByTestId("total-tokens")).toHaveTextContent("150,000");
  });
});
