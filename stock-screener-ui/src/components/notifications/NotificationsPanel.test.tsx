// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { NotificationsPanel } from "./NotificationsPanel";
import { fetchSurges } from "../../api/notifications";
import { createSignal } from "solid-js";
import type { PriceSurgeEvent } from "../../types/notifications";

vi.mock("../../api/notifications", () => ({
  fetchSurges: vi.fn(),
}));

const mockedFetchSurges = vi.mocked(fetchSurges);

function makeEvent(overrides: Partial<PriceSurgeEvent> = {}): PriceSurgeEvent {
  return {
    id: 1,
    symbol: "RELIANCE",
    move_pct: 2.5,
    direction: "up",
    price: 2500,
    screener_id: "trending",
    screen_label: "Trending",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("NotificationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the first page when opened", async () => {
    mockedFetchSurges.mockResolvedValueOnce({ total: 1, events: [makeEvent()] });
    render(() => (<UIProvider>
        <NotificationsPanel opened onClose={vi.fn()} />
      </UIProvider>),
    );

    expect(await screen.findByTestId("surge-card-1")).toBeInTheDocument();
    expect(mockedFetchSurges).toHaveBeenCalledWith(10, 0);
  });

  it("appends the next page without duplicating overlapping events", async () => {
    mockedFetchSurges
      .mockResolvedValueOnce({ total: 3, events: [makeEvent({ id: 1 }), makeEvent({ id: 2, symbol: "TCS" })] })
      .mockResolvedValueOnce({
        total: 3,
        events: [makeEvent({ id: 2, symbol: "TCS" }), makeEvent({ id: 3, symbol: "INFY" })],
      });
        render(() => (<UIProvider>
        <NotificationsPanel opened onClose={vi.fn()} />
      </UIProvider>),
    );

    await fireEvent.click(await screen.findByTestId("surge-alerts-more"));

    expect(mockedFetchSurges).toHaveBeenCalledWith(10, 10);
    expect(await screen.findByTestId("surge-card-3")).toBeInTheDocument();
    expect(screen.getAllByTestId("surge-card-2")).toHaveLength(1);
  });

  it("resets pagination when the panel is reopened", async () => {
    mockedFetchSurges
      .mockResolvedValueOnce({ total: 12, events: [makeEvent({ id: 1 })] })
      .mockResolvedValueOnce({ total: 12, events: [makeEvent({ id: 11 })] })
      .mockResolvedValueOnce({ total: 12, events: [makeEvent({ id: 1 })] });
    const [opened, setOpened] = createSignal(true);
    render(() => (<UIProvider>
        <NotificationsPanel opened={opened()} onClose={vi.fn()} />
      </UIProvider>),
    );

    await fireEvent.click(await screen.findByTestId("surge-alerts-more"));
    expect(await screen.findByTestId("surge-card-11")).toBeInTheDocument();

    setOpened(false);
    setOpened(true);

    await waitFor(() => {
      expect(screen.getByTestId("surge-card-1")).toBeInTheDocument();
      expect(mockedFetchSurges).toHaveBeenLastCalledWith(10, 0);
    });
  });

  it("shows an error and retries the same page", async () => {
    mockedFetchSurges.mockRejectedValueOnce(new Error("Network error"));
        render(() => (<UIProvider>
        <NotificationsPanel opened onClose={vi.fn()} />
      </UIProvider>),
    );

    expect(await screen.findByTestId("surge-alerts-error")).toBeInTheDocument();
    mockedFetchSurges.mockResolvedValueOnce({ total: 1, events: [makeEvent()] });
    await fireEvent.click(screen.getByText("Retry"));

    expect(await screen.findByTestId("surge-card-1")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedFetchSurges).toHaveBeenCalledTimes(2);
    });
  });
});
