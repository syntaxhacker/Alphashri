// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderWithMantine } from "../../../test-utils/renderWithMantine";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChainSubHeader } from "./ChainSubHeader";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockStyles = {
  subHeader: { display: "flex" },
  subHeaderCell: { flex: 1, textAlign: "center" as const, fontSize: "10px" },
};

describe("ChainSubHeader", () => {
  it("renders subheader container", () => {
    renderWithMantine(<ChainSubHeader styles={mockStyles as any} />);
    expect(screen.getByTestId("options-chain-table-subheader")).toBeInTheDocument();
  });

  it("renders column labels", () => {
    renderWithMantine(<ChainSubHeader styles={mockStyles as any} />);
    const subheader = screen.getByTestId("options-chain-table-subheader");
    expect(subheader.textContent).toContain("OI");
    expect(subheader.textContent).toContain("OI CHG");
    expect(subheader.textContent).toContain("VOL");
    expect(subheader.textContent).toContain("IV");
    expect(subheader.textContent).toContain("LTP");
  });
});
