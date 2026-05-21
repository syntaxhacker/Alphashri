// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { renderWithMantine } from "../../../test-utils/renderWithMantine";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChainTableHeader } from "./ChainTableHeader";

afterEach(() => cleanup());

const mockTheme = {
  colors: {
    green: ["#f0fdf4", "#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d"],
    red: ["#fef2f2", "#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d"],
    yellow: ["#fefce8", "#fef9c3", "#fef08a", "#fde047", "#facc15", "#eab308", "#ca8a04", "#a16207", "#854d0e", "#713f12"],
    gray: ["#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827"],
  },
  defaultRadius: "sm",
  fontFamily: "sans-serif",
  fontSizes: { xs: "12px", sm: "14px", md: "16px", lg: "18px", xl: "20px" },
  lineHeights: { xs: "1.4", sm: "1.45", md: "1.55", lg: "1.6", xl: "1.65" },
  spacing: { xs: "10px", sm: "12px", md: "16px", lg: "20px", xl: "24px" },
  headings: { fontFamily: "sans-serif" },
};

const mockStyles = {
  header: { display: "flex" as const },
  headerCell: { flex: 1 as const, textAlign: "center" as const },
};

describe("ChainTableHeader", () => {
  it("renders header container", () => {
    renderWithMantine(
      <ChainTableHeader theme={mockTheme as any} styles={mockStyles as any} />,
    );
    expect(screen.getByTestId("options-chain-table-header")).toBeInTheDocument();
  });

  it("renders CALLS (CE) header", () => {
    renderWithMantine(
      <ChainTableHeader theme={mockTheme as any} styles={mockStyles as any} />,
    );
    expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
  });

  it("renders STRIKE header", () => {
    renderWithMantine(
      <ChainTableHeader theme={mockTheme as any} styles={mockStyles as any} />,
    );
    expect(screen.getByText("STRIKE")).toBeInTheDocument();
  });

  it("renders PUTS (PE) header", () => {
    renderWithMantine(
      <ChainTableHeader theme={mockTheme as any} styles={mockStyles as any} />,
    );
    expect(screen.getByText("PUTS (PE)")).toBeInTheDocument();
  });
});
