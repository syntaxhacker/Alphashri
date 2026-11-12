// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { NotificationsPanel } from "./NotificationsPanel";
import { fetchSurges } from "../../api/notifications";
import { createSignal } from "solid-js";
import type { PriceSurgeEvent } from "../../types/notifications";

vi.mock("../../api/notifications", () => ({ fetchSurges: vi.fn() }));
const mockedFetchSurges = vi.mocked(fetchSurges);
const makeEvent = (id: number, symbol = "RELIANCE"): PriceSurgeEvent => ({
  id, symbol, move_pct: 2.5, direction: "up", price: 2500,
  screener_id: "trending", screen_label: "Trending", created_at: new Date().toISOString(),
});

afterEach(() => cleanup());

it("reopen re-fetches page 0", async () => {
  mockedFetchSurges
    .mockResolvedValueOnce({ total: 12, events: [makeEvent(1)] })
    .mockResolvedValueOnce({ total: 12, events: [makeEvent(11, "TCS")] })
    .mockResolvedValueOnce({ total: 12, events: [makeEvent(1)] });
  const [opened, setOpened] = createSignal(true);
  render(() => (
    <UIProvider>
      <NotificationsPanel opened={opened()} onClose={vi.fn()} />
    </UIProvider>
  ));
  expect(await screen.findByTestId("surge-card-1")).toBeInTheDocument();
  await fireEvent.click(await screen.findByTestId("surge-alerts-more"));
  expect(await screen.findByTestId("surge-card-11")).toBeInTheDocument();
  console.log("MOCK CALLS AFTER MORE:", mockedFetchSurges.mock.calls.length);
  setOpened(false);
  setOpened(true);
  await waitFor(() => {
    console.log("MOCK CALLS AFTER REOPEN:", mockedFetchSurges.mock.calls.length);
    expect(mockedFetchSurges.mock.calls.length).toBe(3);
  });
  expect(await screen.findByTestId("surge-card-1")).toBeInTheDocument();
});
