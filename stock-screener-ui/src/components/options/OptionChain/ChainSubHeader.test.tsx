// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});

import { ChainSubHeader } from "./ChainSubHeader";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockStyles = {
  subHeader: { display: "flex" },
  subHeaderCell: { flex: 1, textAlign: "center" as const, fontSize: "12px" },
};

describe("ChainSubHeader", () => {
  it("renders all eleven column labels in the full grid", () => {
    render(() => <ChainSubHeader styles={mockStyles as any} />);
    const subheader = screen.getByTestId("options-chain-table-subheader");
    expect(subheader.textContent).toContain("OI");
    expect(subheader.textContent).toContain("OI CHG");
    expect(subheader.textContent).toContain("VOL");
    expect(subheader.textContent).toContain("IV");
    expect(subheader.textContent).toContain("LTP");
    expect(subheader.children).toHaveLength(11);
  });

  it("renders only the core OI/LTP columns when compact", () => {
    render(() => <ChainSubHeader styles={mockStyles as any} compact />);
    const subheader = screen.getByTestId("options-chain-table-subheader");
    expect(Array.from(subheader.children).map((cell) => cell.textContent)).toEqual([
      "OI",
      "LTP",
      "",
      "LTP",
      "OI",
    ]);
  });
});
