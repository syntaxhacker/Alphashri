// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UIProvider } from "@/ui";
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
      <UIProvider>
        <ClickableSymbol symbol="RELIANCE" {...props} />
      </UIProvider>
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

  it("navigates to /chart/{symbol} on click", async () => {
      const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByText("RELIANCE"));
    expect(mocks.navigate).toHaveBeenCalledWith("/chart/RELIANCE");
  });

  it("calls onClick when provided", async () => {
      const user = userEvent.setup();
    const onClick = vi.fn();
    renderComponent({ onClick });
    await user.click(screen.getByText("RELIANCE"));
    expect(onClick).toHaveBeenCalledWith("RELIANCE");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("stops click propagation when stopClickPropagation=true", async () => {
      const user = userEvent.setup();
    const parentHandler = vi.fn();
    render(
      <BrowserRouter>
        <UIProvider>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div onClick={parentHandler}>
            <ClickableSymbol symbol="RELIANCE" stopClickPropagation />
          </div>
        </UIProvider>
      </BrowserRouter>,
    );
    await user.click(screen.getByText("RELIANCE"));
    expect(parentHandler).not.toHaveBeenCalled();
  });

  it("shows preview chart on hover when showPreview=true", async () => {
      const user = userEvent.setup();
    renderComponent({ showPreview: true });
    await user.hover(screen.getByText("RELIANCE"));
    expect(mocks.showPreviewChart).toHaveBeenCalled();
  });

  it("hides preview chart on mouse leave", async () => {
      const user = userEvent.setup();
    renderComponent({ showPreview: true });
    await user.hover(screen.getByText("RELIANCE"));
    await user.unhover(screen.getByText("RELIANCE"));
    expect(mocks.hidePreviewChart).toHaveBeenCalled();
  });

  it("debounces hover preview with timeout", async () => {
      const user = userEvent.setup();
    renderComponent({ showPreview: true, previewTimeout: 5000 });
    await user.hover(screen.getByText("RELIANCE"));
    await user.unhover(screen.getByText("RELIANCE"));
    expect(mocks.hidePreviewChart).toHaveBeenCalled();
  });
});
