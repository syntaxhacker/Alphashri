// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { AdminPatternTimeframesPanel, formatDuration } from "./AdminPatternTimeframesPanel";
import {
  addAdminPatternTimeframe,
  deleteAdminPatternTimeframe,
  fetchAdminPatternTimeframes,
  reorderAdminPatternTimeframes,
  setAdminPatternTimeframeEnabled,
} from "../../api/adminPatternTimeframes";
import type { AdminPatternTimeframe } from "../../types/admin";

const mockFetchWithAuth = vi.fn();

vi.mock("../../components/auth/AuthProvider2", () => ({
  useAuth: () => ({ fetchWithAuth: mockFetchWithAuth }),
}));

vi.mock("../../api/adminPatternTimeframes", () => ({
  fetchAdminPatternTimeframes: vi.fn(),
  setAdminPatternTimeframeEnabled: vi.fn(),
  reorderAdminPatternTimeframes: vi.fn(),
  addAdminPatternTimeframe: vi.fn(),
  deleteAdminPatternTimeframe: vi.fn(),
}));

// The @/ui Box/Flex/... stubs from src/pages/solidTestStubs.tsx render as
// intrinsic elements; page tests exercise page wiring, not the theme runtime.
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

const renderPanel = () => render(() => <AdminPatternTimeframesPanel />);

const fetchMock = vi.mocked(fetchAdminPatternTimeframes);
const patchMock = vi.mocked(setAdminPatternTimeframeEnabled);
const reorderMock = vi.mocked(reorderAdminPatternTimeframes);
const addMock = vi.mocked(addAdminPatternTimeframe);
const deleteMock = vi.mocked(deleteAdminPatternTimeframe);

function timeframe(overrides: Partial<AdminPatternTimeframe> = {}): AdminPatternTimeframe {
  return {
    id: "1m",
    label: "1m",
    minutes: 1,
    native: true,
    source_tf: null,
    max_lookback_days: 30,
    min_bars: 60,
    enabled: true,
    sort_order: 0,
    custom: false,
    ...overrides,
  };
}

const BUILTIN_FIXTURES: AdminPatternTimeframe[] = [
  timeframe({ id: "1m", label: "1m", minutes: 1, native: true, source_tf: null, enabled: true, sort_order: 0 }),
  timeframe({ id: "3m", label: "3m", minutes: 3, native: false, source_tf: "1m", enabled: false, sort_order: 1 }),
  timeframe({ id: "2h", label: "2h", minutes: 120, native: false, source_tf: "1h", enabled: false, sort_order: 2 }),
  timeframe({ id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, enabled: true, sort_order: 3 }),
];

const CUSTOM_ROW: AdminPatternTimeframe = timeframe({
  id: "45m",
  label: "45m",
  minutes: 45,
  native: false,
  source_tf: "15m",
  enabled: true,
  sort_order: 4,
  custom: true,
});

const FIXTURES: AdminPatternTimeframe[] = [...BUILTIN_FIXTURES, CUSTOM_ROW];

function amountInput(): HTMLElement {
  return within(screen.getByTestId("admin-tf-amount")).getByRole("spinbutton");
}

async function chooseUnit(label: string): Promise<void> {
  const select = within(screen.getByTestId("admin-tf-unit")).getByRole("combobox") as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.textContent === label);
  fireEvent.input(select, { target: { value: option?.value ?? label } });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(FIXTURES);
  patchMock.mockImplementation(async (_fetch, id, enabled) => ({
    ...FIXTURES.find((tf) => tf.id === id)!,
    enabled,
  }));
  reorderMock.mockImplementation(async (_fetch, ids) =>
    ids.map((id, index) => ({ ...FIXTURES.find((tf) => tf.id === id)!, sort_order: index })),
  );
  addMock.mockImplementation(async (_fetch, payload) => timeframe({ ...payload, custom: true }));
  deleteMock.mockResolvedValue("45m");
});

describe("formatDuration", () => {
  it("formats minutes, hours, days, weeks and months", () => {
    expect(formatDuration(3)).toBe("3 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(1440)).toBe("1 D");
    expect(formatDuration(10080)).toBe("1 W");
    expect(formatDuration(43200)).toBe("1 M");
  });
});

describe("AdminPatternTimeframesPanel", () => {
  it("renders one row per timeframe with durations and lowercase labels", async () => {
    renderPanel();

    expect(await screen.findByTestId("admin-pattern-timeframes")).toBeInTheDocument();
    for (const tf of FIXTURES) {
      expect(screen.getByTestId(`admin-tf-row-${tf.id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("admin-tf-label-3m").textContent).toBe("3m");
    expect(screen.getByTestId("admin-tf-label-2h").textContent).toBe("2h");
    expect(within(screen.getByTestId("admin-tf-row-2h")).getByText("2 h")).toBeInTheDocument();
    expect(within(screen.getByTestId("admin-tf-row-1D")).getByText("1 D")).toBeInTheDocument();
    expect(screen.queryByText("3M")).toBeNull();
  });

  it("shows the enabled/total summary and the default-off note", async () => {
    renderPanel();

    expect(await screen.findByTestId("admin-tf-summary")).toHaveTextContent("3 enabled / 5 total");
    expect(screen.getByTestId("admin-tf-note")).toHaveTextContent("3m and 2h are off by default");
  });

  it("reflects enabled and disabled switches", async () => {
    renderPanel();

    expect(await screen.findByTestId("admin-tf-toggle-1m")).toBeChecked();
    expect(screen.getByTestId("admin-tf-toggle-3m")).not.toBeChecked();
    expect(screen.getByTestId("admin-tf-toggle-2h")).not.toBeChecked();
    expect(screen.getByTestId("admin-tf-toggle-1D")).toBeChecked();
  });

  it("enables 3m through the API and turns the switch on", async () => {
    renderPanel();

    const toggle = await screen.findByTestId("admin-tf-toggle-3m");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(mockFetchWithAuth, "3m", true),
    );
    await waitFor(() => expect(screen.getByTestId("admin-tf-toggle-3m")).toBeChecked());
    expect(screen.getByTestId("admin-tf-summary")).toHaveTextContent("4 enabled / 5 total");
  });

  it("shows an error alert and reverts the switch when the PATCH fails", async () => {
    patchMock.mockRejectedValueOnce(new Error("timeframe locked"));
    renderPanel();

    const toggle = await screen.findByTestId("admin-tf-toggle-3m");
    fireEvent.click(toggle);

    expect(await screen.findByTestId("admin-tf-error")).toHaveTextContent("timeframe locked");
    await waitFor(() => expect(screen.getByTestId("admin-tf-toggle-3m")).not.toBeChecked());
    expect(screen.getByTestId("admin-tf-summary")).toHaveTextContent("3 enabled / 5 total");
  });

  it("reorders down through the API with the reordered ids", async () => {
    renderPanel();

    await screen.findByTestId("admin-pattern-timeframes");
    fireEvent.click(screen.getByTestId("admin-tf-down-1m"));

    await waitFor(() =>
      expect(reorderMock).toHaveBeenCalledWith(mockFetchWithAuth, ["3m", "1m", "2h", "1D", "45m"]),
    );
  });

  it("shows the load error alert when the fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("admin unavailable"));
    renderPanel();

    expect(await screen.findByTestId("admin-tf-load-error")).toHaveTextContent("admin unavailable");
  });

  it("shows the empty state when no timeframes are returned", async () => {
    fetchMock.mockResolvedValueOnce([]);
    renderPanel();

    expect(await screen.findByText("No timeframes configured")).toBeInTheDocument();
    expect(screen.getByTestId("admin-tf-summary")).toHaveTextContent("0 enabled / 0 total");
  });

  it("renders the compact add row with the format hint", async () => {
    renderPanel();

    expect(await screen.findByTestId("admin-tf-add-row")).toBeInTheDocument();
    expect(screen.getByTestId("admin-tf-amount")).toBeInTheDocument();
    expect(screen.getByTestId("admin-tf-unit")).toBeInTheDocument();
    expect(screen.getByTestId("admin-tf-add")).toBeInTheDocument();
    expect(screen.getByText("e.g. 45m, 6h, 2D, 3W, 3M")).toBeInTheDocument();
  });

  it("adds 45 minutes through the API and appends the row", async () => {
    fetchMock.mockResolvedValue(BUILTIN_FIXTURES);
    renderPanel();

    await screen.findByTestId("admin-pattern-timeframes");
    fireEvent.input(amountInput(), { target: { value: "45" } });
    fireEvent.click(screen.getByTestId("admin-tf-add"));

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        mockFetchWithAuth,
        expect.objectContaining({ id: "45m", label: "45m", minutes: 45 }),
      ),
    );
    expect(await screen.findByTestId("admin-tf-row-45m")).toBeInTheDocument();
    expect((amountInput() as HTMLInputElement).value).toBe("");
  });

  it("passes an explicit native source when one is picked", async () => {
    fetchMock.mockResolvedValue(BUILTIN_FIXTURES);
    renderPanel();

    await screen.findByTestId("admin-pattern-timeframes");
    fireEvent.input(amountInput(), { target: { value: "45" } });
    fireEvent.input(within(screen.getByTestId("admin-tf-source")).getByRole("combobox"), { target: { value: "1m" } });
    fireEvent.click(screen.getByTestId("admin-tf-add"));

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        mockFetchWithAuth,
        expect.objectContaining({ id: "45m", minutes: 45, source_tf: "1m" }),
      ),
    );
  });

  it.each([
    ["hours", 6, "6h", 360],
    ["days", 2, "2D", 2880],
    ["weeks", 3, "3W", 30240],
    ["months", 3, "3M", 129600],
  ])("computes minutes for %s", async (label, amount, id, minutes) => {
    renderPanel();

    await screen.findByTestId("admin-pattern-timeframes");
    fireEvent.input(amountInput(), { target: { value: String(amount) } });
    await chooseUnit(label);
    fireEvent.click(screen.getByTestId("admin-tf-add"));

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        mockFetchWithAuth,
        expect.objectContaining({ id, label: id, minutes }),
      ),
    );
  });

  it("disables Add for an existing id and for an invalid amount", async () => {
    renderPanel();

    await screen.findByTestId("admin-pattern-timeframes");
    const addButton = () => screen.getByTestId("admin-tf-add");
    expect(addButton()).toBeDisabled();

    fireEvent.input(amountInput(), { target: { value: "0" } });
    expect(addButton()).toBeDisabled();

    fireEvent.input(amountInput(), { target: { value: "45" } });
    expect(addButton()).toBeDisabled();

    fireEvent.input(amountInput(), { target: { value: "46" } });
    expect(addButton()).toBeEnabled();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("shows an inline error when the add fails", async () => {
    addMock.mockRejectedValueOnce(new Error("invalid timeframe"));
    renderPanel();

    await screen.findByTestId("admin-pattern-timeframes");
    fireEvent.input(amountInput(), { target: { value: "7" } });
    fireEvent.click(screen.getByTestId("admin-tf-add"));

    expect(await screen.findByTestId("admin-tf-add-error")).toHaveTextContent("invalid timeframe");
    expect(screen.getByTestId("admin-tf-error")).toHaveTextContent("invalid timeframe");
    expect(screen.queryByTestId("admin-tf-row-7m")).toBeNull();
  });

  it("renders delete only for custom rows and removes the row on success", async () => {
    renderPanel();

    await screen.findByTestId("admin-pattern-timeframes");
    expect(screen.queryByTestId("admin-tf-delete-1m")).toBeNull();
    expect(screen.queryByTestId("admin-tf-delete-3m")).toBeNull();
    expect(screen.queryByTestId("admin-tf-delete-1D")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete 45m" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-tf-delete-45m"));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(mockFetchWithAuth, "45m"));
    await waitFor(() => expect(screen.queryByTestId("admin-tf-row-45m")).toBeNull());
  });

  it("restores the row and shows the error when delete fails", async () => {
    deleteMock.mockRejectedValueOnce(new Error("cannot delete"));
    renderPanel();

    await screen.findByTestId("admin-pattern-timeframes");
    fireEvent.click(screen.getByTestId("admin-tf-delete-45m"));

    expect(await screen.findByTestId("admin-tf-error")).toHaveTextContent("cannot delete");
    expect(screen.getByTestId("admin-tf-row-45m")).toBeInTheDocument();
  });
});
