// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
    const user = userEvent.setup();
    renderAt("/poc/replay/vwap-orb");

    const select = screen.getByLabelText("Strategy");
    expect(select).toBeInTheDocument();

    await user.click(select);
    // current strategy is listed (and therefore registered)
    expect(await screen.findByRole("option", { name: "VWAP + ORB" })).toBeInTheDocument();
    const option = await screen.findByRole("option", { name: "SMC iFVG" });
    await user.click(option);

    expect(screen.getByTestId("loc").textContent).toBe("/poc/replay/smc-ifvg");
  });
});
