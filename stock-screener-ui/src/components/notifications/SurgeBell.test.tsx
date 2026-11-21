// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { SidebarHeader } from "../layout/SidebarHeader";
import {
  useSurgeAlertTotal,
} from "./NotificationsPanel";
import {
  surgeAriaLabel,
  surgeBadgeText,
} from "./surgeAlertCount";
import {
  acknowledgeSurgeAlerts,
  resetSurgeAcknowledgement,
} from "../../state/store/notificationsSlice";
import { fetchSurges } from "../../api/notifications";
import type { PriceSurgeEvent } from "../../types/notifications";

vi.mock("../../api/notifications", () => ({ fetchSurges: vi.fn() }));
vi.mock("../news/NewsPanel", () => ({ default: () => <div data-testid="news-mock" /> }));
vi.mock("../layout/MarketTicker", () => ({
  MarketStatus: () => <div data-testid="market-status-mock" />,
  MarketTicker: () => <div data-testid="market-ticker-mock" />,
}));

const mockedFetchSurges = vi.mocked(fetchSurges);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istIso(hour: number, dayOffset = 0): string {
  const base = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dayOffset, hour) - IST_OFFSET_MS,
  ).toISOString();
}

function historicEvent(id: number): PriceSurgeEvent {
  return {
    id,
    symbol: `OLD${id}`,
    move_pct: 2,
    direction: "up",
    price: 100,
    screener_id: "s",
    screen_label: "L",
    created_at: istIso(10, -1),
  };
}

function BellProbe() {
  const unread = useSurgeAlertTotal();
  return (
    <div>
      <span data-testid="probe-unread">{unread()}</span>
      <span data-testid="probe-label">{surgeAriaLabel(unread())}</span>
      <span data-testid="probe-badge">{surgeBadgeText(unread()) ?? "none"}</span>
      <button data-testid="probe-ack" onClick={() => acknowledgeSurgeAlerts(3)}>ack</button>
    </div>
  );
}

describe("notification bell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSurgeAcknowledgement();
  });

  afterEach(() => cleanup());

  it("never announces the all-time row count on the bell", () => {
    render(() => (
      <UIProvider>
        <SidebarHeader surgeTotal={7094} onToggleCollapse={vi.fn()} onOpenNotifications={vi.fn()} />
      </UIProvider>
    ));

    const bell = screen.getByTestId("notif-bell");
    expect(bell).toHaveAttribute("aria-label", "Notifications, 99+ unread today");
    expect(bell.getAttribute("aria-label")?.includes("7094")).toBe(false);
    expect(screen.getByTestId("notif-badge")).toHaveTextContent("9+");
  });

  it("announces the bounded count with explicit 'unread today' semantics", () => {
    render(() => (
      <UIProvider>
        <SidebarHeader surgeTotal={3} onToggleCollapse={vi.fn()} onOpenNotifications={vi.fn()} />
      </UIProvider>
    ));

    expect(screen.getByTestId("notif-bell")).toHaveAttribute("aria-label", "Notifications, 3 unread today");
    expect(screen.getByTestId("notif-badge")).toHaveTextContent("3");
  });

  it("says 'Notifications' with no badge when nothing is unread", () => {
    render(() => (
      <UIProvider>
        <SidebarHeader surgeTotal={0} onToggleCollapse={vi.fn()} onOpenNotifications={vi.fn()} />
      </UIProvider>
    ));

    expect(screen.getByTestId("notif-bell")).toHaveAttribute("aria-label", "Notifications");
    expect(screen.queryByTestId("notif-badge")).not.toBeInTheDocument();
  });

  it("a fixture with thousands of historical alerts shows only today's unread count", async () => {
    const historical = Array.from({ length: 7094 }, (_, i) => historicEvent(i + 1));
    mockedFetchSurges.mockResolvedValue({ total: 7094, today_count: 3, events: historical });

    render(() => (
      <UIProvider>
        <BellProbe />
      </UIProvider>
    ));

    await waitFor(() => {
      expect(screen.getByTestId("probe-unread").textContent).toBe("3");
    });
    expect(screen.getByTestId("probe-label").textContent).toBe("Notifications, 3 unread today");
    expect(screen.getByTestId("probe-label").textContent).not.toContain("7094");
    expect(screen.getByTestId("probe-badge").textContent).toBe("3");
  });

  it("marking all read updates the label and removes the badge", async () => {
    mockedFetchSurges.mockResolvedValue({
      total: 7094,
      today_count: 3,
      events: Array.from({ length: 7094 }, (_, i) => historicEvent(i + 1)),
    });

    render(() => (
      <UIProvider>
        <BellProbe />
      </UIProvider>
    ));

    await waitFor(() => {
      expect(screen.getByTestId("probe-unread").textContent).toBe("3");
    });
    fireEvent.click(screen.getByTestId("probe-ack"));

    expect(screen.getByTestId("probe-unread").textContent).toBe("0");
    expect(screen.getByTestId("probe-label").textContent).toBe("Notifications");
    expect(screen.getByTestId("probe-badge").textContent).toBe("none");
  });

  it("an empty today says 'Notifications' even with a huge all-time history", async () => {
    mockedFetchSurges.mockResolvedValue({
      total: 7094,
      today_count: 0,
      events: [historicEvent(1)],
    });

    render(() => (
      <UIProvider>
        <BellProbe />
      </UIProvider>
    ));

    await waitFor(() => {
      expect(fetchSurges).toHaveBeenCalled();
    });
    expect(screen.getByTestId("probe-unread").textContent).toBe("0");
    expect(screen.getByTestId("probe-label").textContent).toBe("Notifications");
    expect(screen.getByTestId("probe-badge").textContent).toBe("none");
  });
});
