// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { formatSurgeMove, NotificationsPanel } from "./NotificationsPanel";
import { fetchSurges } from "../../api/notifications";
import { createSignal } from "solid-js";
import type { PriceSurgeEvent } from "../../types/notifications";
import {
  unreadSurgeCount,
  resetSurgeAcknowledgement,
} from "../../state/store/notificationsSlice";

vi.mock("../../api/notifications", () => ({
  fetchSurges: vi.fn(),
}));

const dock = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("../common/symbolDockContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../common/symbolDockContext")>()),
  useSymbolDock: () => ({
    open: dock.open,
    preview: vi.fn(),
    endPreview: vi.fn(),
    close: vi.fn(),
    setOutlet: vi.fn(),
    pinned: false,
  }),
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
    resetSurgeAcknowledgement();
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

  it("renders canonical surge symbols without leaking exchange prefixes", async () => {
    mockedFetchSurges.mockResolvedValueOnce({
      total: 1,
      events: [makeEvent({ id: 7, symbol: "NSE:RELIANCE" })],
    });
    render(() => (<UIProvider>
        <NotificationsPanel opened onClose={vi.fn()} />
      </UIProvider>),
    );

    const card = await screen.findByTestId("surge-card-7");
    expect(card).toHaveTextContent("RELIANCE");
    expect(card).not.toHaveTextContent("NSE:");
  });

  it("acknowledges today's alerts when the first page loads", async () => {
    mockedFetchSurges.mockResolvedValueOnce({
      total: 7094,
      today_count: 4,
      events: [makeEvent()],
    });

    render(() => (<UIProvider>
        <NotificationsPanel opened onClose={vi.fn()} />
      </UIProvider>),
    );

    expect(await screen.findByTestId("surge-card-1")).toBeInTheDocument();
    expect(unreadSurgeCount(4)).toBe(0);
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

  // The panel used to render a title bar with no exit — only a reload escaped.
  it("closes via the × in the title bar", async () => {
    mockedFetchSurges.mockResolvedValueOnce({ total: 0, events: [] });
    const onClose = vi.fn();
    render(() => (
      <UIProvider>
        <NotificationsPanel opened onClose={onClose} />
      </UIProvider>
    ));

    const close = await screen.findByLabelText("close");
    await fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via Escape", async () => {
    mockedFetchSurges.mockResolvedValueOnce({ total: 0, events: [] });
    const onClose = vi.fn();
    render(() => (
      <UIProvider>
        <NotificationsPanel opened onClose={onClose} />
      </UIProvider>
    ));

    await screen.findByText(/Surge Alerts/);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via a backdrop click", async () => {
    mockedFetchSurges.mockResolvedValueOnce({ total: 0, events: [] });
    const onClose = vi.fn();
    render(() => (
      <UIProvider>
        <NotificationsPanel opened onClose={onClose} />
      </UIProvider>
    ));

    await screen.findByText(/Surge Alerts/);
    await fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens a surge card symbol through the dock on click and keyboard", async () => {
    mockedFetchSurges.mockResolvedValueOnce({ total: 1, events: [makeEvent()] });
    render(() => (<UIProvider>
        <NotificationsPanel opened onClose={vi.fn()} />
      </UIProvider>),
    );

    const symbol = await screen.findByTestId("surge-symbol-1");
    expect(symbol.tagName).toBe("BUTTON");
    expect(symbol).toHaveAttribute("aria-label", "Open RELIANCE chart");

    await fireEvent.click(symbol);
    expect(dock.open).toHaveBeenCalledWith("RELIANCE");

    dock.open.mockClear();
    await fireEvent.keyDown(symbol, { key: "Enter" });
    expect(dock.open).toHaveBeenCalledWith("RELIANCE");

    dock.open.mockClear();
    await fireEvent.keyDown(symbol, { key: " " });
    expect(dock.open).toHaveBeenCalledWith("RELIANCE");
  });
});

describe("surge move formatting", () => {
  it("derives the sign from the value, never showing -0.0%", () => {
    expect(formatSurgeMove(-0.04)).toBe("0.0%");
    expect(formatSurgeMove(0.04)).toBe("0.0%");
    expect(formatSurgeMove(-2.5)).toBe("-2.5%");
    expect(formatSurgeMove(2.5)).toBe("+2.5%");
  });

  it("renders a tiny negative alert without the -0.0% artifact", async () => {
    mockedFetchSurges.mockResolvedValueOnce({
      total: 1,
      events: [makeEvent({ move_pct: -0.04, direction: "down" })],
    });
    render(() => (<UIProvider>
        <NotificationsPanel opened onClose={vi.fn()} />
      </UIProvider>),
    );

    const card = await screen.findByTestId("surge-card-1");
    expect(card).toHaveTextContent("0.0%");
    expect(card).not.toHaveTextContent("-0.0%");
  });
});
