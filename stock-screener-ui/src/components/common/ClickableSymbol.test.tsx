// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { BrowserRouter } from "react-router-dom";
import { ClickableSymbol } from "./ClickableSymbol";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  showPreviewChart: vi.fn(),
  hidePreviewChart: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("./PreviewChartProvider", () => ({
  usePreviewChart: () => ({
    showPreviewChart: mocks.showPreviewChart,
    hidePreviewChart: mocks.hidePreviewChart,
  }),
}));

function renderComponent(props: Record<string, any> = {}) {
  return render(
    <BrowserRouter>
      <MantineProvider>
        <ClickableSymbol symbol="RELIANCE" {...props} />
      </MantineProvider>
    </BrowserRouter>,
  );
}

describe("ClickableSymbol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders symbol as clickable Anchor", () => {
    renderComponent();
    const el = screen.getByText("RELIANCE");
    expect(el).toBeInTheDocument();
    expect(el.tagName).toBe("BUTTON");
  });

  it("navigates to /chart/{symbol} on click", () => {
    renderComponent();
    fireEvent.click(screen.getByText("RELIANCE"));
    expect(mocks.navigate).toHaveBeenCalledWith("/chart/RELIANCE");
  });

  it("calls onClick when provided", () => {
    const onClick = vi.fn();
    renderComponent({ onClick });
    fireEvent.click(screen.getByText("RELIANCE"));
    expect(onClick).toHaveBeenCalledWith("RELIANCE");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("stops click propagation when stopClickPropagation=true", () => {
    const parentHandler = vi.fn();
    render(
      <BrowserRouter>
        <MantineProvider>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div onClick={parentHandler}>
            <ClickableSymbol symbol="RELIANCE" stopClickPropagation />
          </div>
        </MantineProvider>
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByText("RELIANCE"));
    expect(parentHandler).not.toHaveBeenCalled();
  });

  it("shows preview chart on hover when showPreview=true", () => {
    renderComponent({ showPreview: true });
    fireEvent.mouseEnter(screen.getByText("RELIANCE"));
    expect(mocks.showPreviewChart).toHaveBeenCalled();
  });

  it("hides preview chart on mouse leave", () => {
    renderComponent({ showPreview: true });
    fireEvent.mouseEnter(screen.getByText("RELIANCE"));
    fireEvent.mouseLeave(screen.getByText("RELIANCE"));
    expect(mocks.hidePreviewChart).toHaveBeenCalled();
  });

  it("debounces hover preview with timeout", () => {
    vi.useFakeTimers();
    renderComponent({ showPreview: true, previewTimeout: 5000 });
    fireEvent.mouseEnter(screen.getByText("RELIANCE"));
    fireEvent.mouseLeave(screen.getByText("RELIANCE"));
    expect(mocks.hidePreviewChart).toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });
});
