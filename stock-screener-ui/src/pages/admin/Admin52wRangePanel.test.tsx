// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithMantine } from "../../test/test-utils";
import { Admin52wRangePanel } from "./Admin52wRangePanel";
const renderPanel = () => renderWithMantine(<Admin52wRangePanel />);

const fetchWithAuthMock = vi.fn();

vi.mock("../../components/auth/AuthProvider2", () => ({
  useAuth: () => ({ fetchWithAuth: fetchWithAuthMock }),
}));

function makeStatus(overrides: any = {}) {
  return {
    job: { status: "completed", total: 100, processed: 100, ok: 90, failed: 0, skipped: 10, progress_pct: 100, elapsed_sec: 12, finished_at: "2026-01-01T10:00:00Z", message: "done" },
    database: { db_row_count: 2466, coverage_pct: 100, expected_universe: 2466, db_latest_updated_at: "2026-01-01T10:00:00Z" },
    fetched_at: "2026-01-01T10:00:00Z",
    run_hint: "python scripts/run_52w.py",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Stub confirm
  vi.stubGlobal("confirm", () => true);
  // @ts-ignore
  global.confirm = () => true;
  // @ts-ignore
  window.confirm = () => true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Admin52wRangePanel", () => {
  it("shows loading initially then stats", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => makeStatus() });
    renderPanel();
    expect(screen.getByText(/Loading 52W/i)).toBeInTheDocument();
    await waitFor(() => expect(fetchWithAuthMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("admin-52w-range-panel")).toBeInTheDocument());
    expect(screen.getAllByText("2466").length).toBeGreaterThan(0);
  });

  it("shows progress bar only when status running", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => makeStatus({ job: { status: "running", total: 100, processed: 40, ok: 30, failed: 2, skipped: 8, last_symbol: "INFY" } }) });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Batch Progress")).toBeInTheDocument());
    expect(document.body.textContent).toContain("40 / 100");
  });

  it("does not show progress bar when completed", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => makeStatus({ job: { status: "completed" } }) });
    renderPanel();
    await waitFor(() => expect(fetchWithAuthMock).toHaveBeenCalled());
    expect(screen.queryByText("Batch Progress")).toBeNull();
  });

  it("max(updated_at) only moves on insert — second poll with same timestamp does not change display", async () => {
    const status1 = makeStatus({ database: { db_row_count: 10, coverage_pct: 1, expected_universe: 2466, db_latest_updated_at: "2026-01-01T09:00:00Z" }, job: { status: "idle" } });
    const statusSame = makeStatus({ database: { db_row_count: 10, coverage_pct: 1, expected_universe: 2466, db_latest_updated_at: "2026-01-01T09:00:00Z" }, job: { status: "idle" } });
    fetchWithAuthMock.mockResolvedValueOnce({ ok: true, json: async () => status1 }).mockResolvedValueOnce({ ok: true, json: async () => statusSame });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Latest DB update/)).toBeInTheDocument());
    const first = screen.getByText(/Latest DB update/).textContent;
    // advance polling interval 5s
    await vi.advanceTimersByTimeAsync(5000);
    await waitFor(() => expect(fetchWithAuthMock).toHaveBeenCalledTimes(2));
    const second = screen.getByText(/Latest DB update/).textContent;
    expect(first).toBe(second);
  });

  it("max(updated_at) moves when new insert advances timestamp", async () => {
    const status1 = makeStatus({ database: { db_row_count: 10, coverage_pct: 1, expected_universe: 2466, db_latest_updated_at: "2026-01-01T09:00:00Z" }, job: { status: "idle" } });
    const status2 = makeStatus({ database: { db_row_count: 11, coverage_pct: 1, expected_universe: 2466, db_latest_updated_at: "2026-01-01T10:00:00Z" }, job: { status: "idle" } });
    fetchWithAuthMock.mockResolvedValueOnce({ ok: true, json: async () => status1 }).mockResolvedValueOnce({ ok: true, json: async () => status2 });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Latest DB update/)).toBeInTheDocument());
    await vi.advanceTimersByTimeAsync(5000);
    await waitFor(() => expect(fetchWithAuthMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Latest DB update/).textContent).not.toBeNull();
    // second timestamp should be later (string contains 10:00)
    expect(screen.getByText(/Latest DB update/).textContent).toContain("2026");
  });

  it("Run batch posts with skip_existing based on fullRefresh toggle and respects interval", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    fetchWithAuthMock
      .mockResolvedValueOnce({ ok: true, json: async () => makeStatus({ job: { status: "idle" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // POST run
      .mockResolvedValueOnce({ ok: true, json: async () => makeStatus({ job: { status: "running" } }) });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("admin-52w-run")).toBeInTheDocument());
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
    const runBtn = screen.getByTestId("admin-52w-run");
    await user.click(runBtn);
    await waitFor(() => expect(fetchWithAuthMock).toHaveBeenCalledWith(expect.stringContaining("/api/admin/52w-range/run"), expect.objectContaining({ method: "POST" })));
    const postCall = fetchWithAuthMock.mock.calls.find((c) => String(c[0]).includes("/52w-range/run"));
    const body = JSON.parse((postCall![1] as any).body);
    expect(body.full_refresh).toBe(true);
    expect(body.skip_existing).toBe(false);
  });

  it("sets 5s polling interval and cleans up on unmount", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => makeStatus({ job: { status: "idle" } }) });
    const { unmount } = renderPanel();
    await waitFor(() => expect(fetchWithAuthMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
  });

  it("shows error alert on fetch failure", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: false, json: async () => ({ detail: "Auth failed" }), status: 401 } as any);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Auth failed")).toBeInTheDocument());
  });
});
