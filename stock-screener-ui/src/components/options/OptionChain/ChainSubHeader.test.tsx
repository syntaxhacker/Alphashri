// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChainSubHeader } from "./ChainSubHeader";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockStyles = {
  subHeader: { display: "flex" },
  subHeaderCell: { flex: 1, "text-align": "center" as const, "font-size": "10px" },
};

describe("ChainSubHeader", () => {
  it("renders column labels", () => {
    renderWithProviders(<ChainSubHeader styles={mockStyles as any} />);
    const subheader = screen.getByTestId("options-chain-table-subheader");
    expect(subheader.textContent).toContain("OI");
    expect(subheader.textContent).toContain("OI CHG");
    expect(subheader.textContent).toContain("VOL");
    expect(subheader.textContent).toContain("IV");
    expect(subheader.textContent).toContain("LTP");
  });
});
