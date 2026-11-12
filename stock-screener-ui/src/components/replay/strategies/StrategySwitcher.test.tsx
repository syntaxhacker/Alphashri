// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { render, screen, within, fireEvent } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory, useLocation } from "@solidjs/router";
import StrategySwitcher from "./StrategySwitcher";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}</div>;
}

function TestPage() {
  return (
    <>
      <StrategySwitcher currentId="vwap-orb" />
      <LocationProbe />
    </>
  );
}

const renderAt = (path: string) => {
  const history = createMemoryHistory();
  history.set({ value: path, scroll: false, replace: true });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/poc/replay/:strategyId" component={TestPage} />
    </MemoryRouter>
  ));
};

describe("StrategySwitcher", () => {
  test("renders the current strategy and navigates to the chosen one", async () => {
    renderAt("/poc/replay/vwap-orb");

    const select = screen.getByLabelText("Strategy");
    expect(select).toBeInTheDocument();

    expect(within(select).getByRole("option", { name: "VWAP + ORB" })).toBeInTheDocument();
    fireEvent.input(select, { target: { value: "smc-ifvg" } });

    // @solidjs/router navigates via startTransition, so the new location lands after a tick.
    await vi.waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/poc/replay/smc-ifvg"));
  });
});
