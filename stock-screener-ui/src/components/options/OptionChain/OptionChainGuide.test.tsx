// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { OptionChainGuide } from "./OptionChainGuide";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OptionChainGuide", () => {
  it("is a compact key, not a how-to-read wall", () => {
    render(() => <OptionChainGuide opened={true} onClose={vi.fn()} />);

    expect(screen.getByText("Option chain key")).toBeInTheDocument();
    expect(screen.queryByText("How to Read the Option Chain")).not.toBeInTheDocument();
    expect(screen.queryByText(/Options can be complex/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PRO TIP/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-guide-pro-tip")).not.toBeInTheDocument();
  });

  it("keeps the CE/PE labels and the decision thresholds", () => {
    render(() => <OptionChainGuide opened={true} onClose={vi.fn()} />);

    expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    expect(screen.getByText("PUTS (PE)")).toBeInTheDocument();
    expect(screen.getByTestId("options-guide-pcr")).toHaveTextContent("> 1.2 bullish · < 0.7 bearish");
    expect(screen.getByTestId("options-guide-max-pain")).toHaveTextContent("expiry magnet, not a target");
    expect(screen.getByTestId("options-guide-oi")).toHaveTextContent("high OI is a wall");
  });

  it("keeps the sentiment code key", () => {
    render(() => <OptionChainGuide opened={true} onClose={vi.fn()} />);

    for (const code of ["lb", "sb", "sc", "lu"]) {
      expect(screen.getByTestId(`options-guide-badge-${code}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("options-guide-badge-lb")).toHaveTextContent("LB · Long buildup");
  });
});
