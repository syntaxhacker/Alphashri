// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { OptionChainGuide } from "./OptionChainGuide";

afterEach(() => cleanup());

function renderWithMantine(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("OptionChainGuide", () => {
  it("renders guide modal when opened", () => {
    renderWithMantine(<OptionChainGuide opened={true} onClose={vi.fn()} />);
    expect(screen.getByTestId("options-chain-guide-modal")).toBeInTheDocument();
  });

  it("shows How to Read title", () => {
    renderWithMantine(<OptionChainGuide opened={true} onClose={vi.fn()} />);
    expect(screen.getByText("How to Read the Option Chain")).toBeInTheDocument();
  });

  it("shows CALL/PE explanation cards", () => {
    renderWithMantine(<OptionChainGuide opened={true} onClose={vi.fn()} />);
    expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    expect(screen.getByText("PUTS (PE)")).toBeInTheDocument();
  });

  it("shows PCR, Max Pain, OI explanations", () => {
    renderWithMantine(<OptionChainGuide opened={true} onClose={vi.fn()} />);
    expect(screen.getByTestId("options-guide-pcr")).toBeInTheDocument();
    expect(screen.getByTestId("options-guide-max-pain")).toBeInTheDocument();
    expect(screen.getByTestId("options-guide-oi")).toBeInTheDocument();
  });

  it("shows sentiment badge meanings", () => {
    renderWithMantine(<OptionChainGuide opened={true} onClose={vi.fn()} />);
    expect(screen.getByTestId("options-guide-badge-lb")).toBeInTheDocument();
    expect(screen.getByTestId("options-guide-badge-sb")).toBeInTheDocument();
    expect(screen.getByTestId("options-guide-badge-sc")).toBeInTheDocument();
    expect(screen.getByTestId("options-guide-badge-lu")).toBeInTheDocument();
  });

  it("shows pro tip", () => {
    renderWithMantine(<OptionChainGuide opened={true} onClose={vi.fn()} />);
    expect(screen.getByTestId("options-guide-pro-tip")).toBeInTheDocument();
  });
});
