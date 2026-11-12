// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { OptionChainGuide } from "./OptionChainGuide";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OptionChainGuide", () => {
  it("shows How to Read title", () => {
    render(() => <OptionChainGuide opened={true} onClose={vi.fn()} />);
    expect(screen.getByText("How to Read the Option Chain")).toBeInTheDocument();
  });

  it("shows CALL/PE explanation cards", () => {
    render(() => <OptionChainGuide opened={true} onClose={vi.fn()} />);
    expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
    expect(screen.getByText("PUTS (PE)")).toBeInTheDocument();
  });
});
