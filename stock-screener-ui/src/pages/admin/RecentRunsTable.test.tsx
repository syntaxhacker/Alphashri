// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RecentRunsTable, ModelBreakdown } from "./RecentRunsTable";
import { MantineProvider } from "@mantine/core";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

vi.mock("../../utils/ui-helpers", () => ({
  getStatusColor: vi.fn((status) => {
    switch (status) {
      case "success":
      case "SUCCESS":
        return "green";
      case "error":
      case "ERROR":
        return "red";
      case "pending":
      case "PENDING":
        return "yellow";
      default:
        return "gray";
    }
  }),
}));

describe("RecentRunsTable", () => {
  beforeEach(() => {
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const mockRuns = [
    {
      id: 1,
      url: "https://api.example.com/v1/chat/completions/very-long-path-that-should-definitely-be-truncated",
      model: "gpt-4",
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 0.045,
      response_time_ms: 1200,
      status: "success",
      created_at: "2025-06-15T10:00:00Z",
    },
    {
      id: 2,
      url: "https://api.example.com/v1/chat/completions",
      model: "claude-3",
      input_tokens: 800,
      output_tokens: 400,
      cost_usd: 0.032,
      response_time_ms: 1500,
      status: "pending",
      created_at: "2025-06-15T09:30:00Z",
    },
  ];

  it("renders empty state when no runs", () => {
    render(
      <MantineProvider>
        <RecentRunsTable runs={[]} />
      </MantineProvider>,
    );

    expect(screen.getByText("No recent runs")).toBeInTheDocument();
  });

  it("renders table with runs", () => {
    render(
      <MantineProvider>
        <RecentRunsTable runs={mockRuns} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("runs-table")).toBeInTheDocument();
  });

  it("displays column headers", () => {
    render(
      <MantineProvider>
        <RecentRunsTable runs={mockRuns} />
      </MantineProvider>,
    );

    expect(screen.getByText("URL")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("Response Time")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Created At")).toBeInTheDocument();
  });

  it("displays run data in table", () => {
    render(
      <MantineProvider>
        <RecentRunsTable runs={mockRuns} />
      </MantineProvider>,
    );

    expect(screen.getByText("gpt-4")).toBeInTheDocument();
    expect(screen.getByText("claude-3")).toBeInTheDocument();
    expect(screen.getByText("$0.0450")).toBeInTheDocument();
    expect(screen.getByText("$0.0320")).toBeInTheDocument();
    expect(screen.getByText("1200ms")).toBeInTheDocument();
    expect(screen.getByText("1500ms")).toBeInTheDocument();
  });

  it("displays status badges", () => {
    render(
      <MantineProvider>
        <RecentRunsTable runs={mockRuns} />
      </MantineProvider>,
    );

    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("displays formatted tokens (input+output)", () => {
    render(
      <MantineProvider>
        <RecentRunsTable runs={mockRuns} />
      </MantineProvider>,
    );

    // 1000+500 = 1500
    expect(screen.getByText("1,500")).toBeInTheDocument();
    // 800+400 = 1200
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });

  it("truncates long URLs", () => {
    render(
      <MantineProvider>
        <RecentRunsTable runs={mockRuns} />
      </MantineProvider>,
    );

    // The URL should be truncated to 50 characters + "..."
    const urlText = screen.getByText((content, element) => {
      return element?.textContent === content && content.includes("...");
    });
    expect(urlText).toBeInTheDocument();
  });
});

describe("ModelBreakdown", () => {
  const mockModels = [
    { model: "gpt-4", count: 50 },
    { model: "claude-3", count: 30 },
  ];

  it("renders nothing when no models", () => {
    render(
      <MantineProvider>
        <ModelBreakdown models={[]} />
      </MantineProvider>,
    );

    expect(screen.queryByText(/runs/)).not.toBeInTheDocument();
  });

  it("renders model badges", () => {
    render(
      <MantineProvider>
        <ModelBreakdown models={mockModels} />
      </MantineProvider>,
    );

    expect(screen.getByText("gpt-4: 50 runs")).toBeInTheDocument();
    expect(screen.getByText("claude-3: 30 runs")).toBeInTheDocument();
  });

  it("renders panel title", () => {
    render(
      <MantineProvider>
        <ModelBreakdown models={mockModels} />
      </MantineProvider>,
    );

    expect(screen.getAllByText("Model Breakdown").length).toBeGreaterThanOrEqual(1);
  });
});
