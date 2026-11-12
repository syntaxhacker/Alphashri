// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen, within, fireEvent } from "@solidjs/testing-library";
import { MemoryRouter, Route, Routes, useLocation } from "@solidjs/router";
import StrategySwitcher from "./StrategySwitcher";

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="loc">{pathname}</div>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/poc/replay/:strategyId"
          element={<><StrategySwitcher currentId="vwap-orb" /><LocationProbe /></>}
        />
      </Routes>
    </MemoryRouter>,
  );

describe("StrategySwitcher", () => {
  test("renders the current strategy and navigates to the chosen one", async () => {
    renderAt("/poc/replay/vwap-orb");

    const select = screen.getByLabelText("Strategy");
    expect(select).toBeInTheDocument();

    expect(within(select).getByRole("option", { name: "VWAP + ORB" })).toBeInTheDocument();
    await fireEvent.input(select, "smc-ifvg");

    expect(screen.getByTestId("loc").textContent).toBe("/poc/replay/smc-ifvg");
  });
});
