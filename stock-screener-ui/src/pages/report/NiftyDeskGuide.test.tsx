// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { DESK_GUIDE_ENTRIES, NiftyDeskGuide } from "./NiftyDeskGuide";

function r(node: React.ReactElement) {
  return render(node, { wrapper: UIProvider });
}

afterEach(cleanup);

describe("NiftyDeskGuide", () => {
  test("the ? button opens the guide and every glossary heading renders", async () => {
    const user = userEvent.setup();
    r(<NiftyDeskGuide />);

    const button = screen.getByTestId("nifty-help-button");
    expect(button).toHaveAttribute("title", "Desk guide");
    expect(button).toHaveAttribute("aria-label", "Desk guide");

    await user.click(button);

    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent(
      "Desk guide — read this once",
    );
    // Content-hugging compact dialog (not the full 88vh research shell).
    expect(screen.getByTestId("panel-modal")).toHaveAttribute("data-compact", "true");
    const modal = screen.getByTestId("nifty-help-modal");
    expect(modal).toHaveStyle({ display: "grid", gap: "8px" });
    for (const entry of DESK_GUIDE_ENTRIES) {
      expect(within(modal).getByText(entry.term)).toBeInTheDocument();
    }
    // The nine sections from the desk legend, in one dense 2-column grid.
    expect(DESK_GUIDE_ENTRIES).toHaveLength(9);
    expect(within(modal).getByText("COIL / NORMAL / EXPANDING")).toBeInTheDocument();
    expect(within(modal).getByText("HEATMAP")).toBeInTheDocument();
    expect(within(modal).getByText("GAMMA (Γ)")).toBeInTheDocument();
    expect(within(modal).getByText("MAX PAIN")).toBeInTheDocument();
    expect(within(modal).getByText("PCR")).toBeInTheDocument();
    expect(within(modal).getByText("SB / LB")).toBeInTheDocument();
    expect(within(modal).getByText("FLOW STRIP")).toBeInTheDocument();
    expect(within(modal).getByText("CAS")).toBeInTheDocument();
    expect(within(modal).getByText("COSTS")).toBeInTheDocument();
  });

  test("the close X dismisses the guide", async () => {
    const user = userEvent.setup();
    r(<NiftyDeskGuide />);

    await user.click(screen.getByTestId("nifty-help-button"));
    expect(screen.getByTestId("nifty-help-modal")).toBeInTheDocument();

    await user.click(screen.getByTestId("panel-modal-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("nifty-help-modal")).not.toBeInTheDocument(),
    );
  });
});
