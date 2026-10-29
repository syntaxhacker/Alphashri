// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { PanelModal } from "./PanelModal";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PanelModal", () => {
  test("renders title, children, and actions when open", () => {
    r(
      <PanelModal open title="Desk plan" onClose={() => {}} actions={<button>Apply</button>}>
        <div data-testid="modal-child">body content</div>
      </PanelModal>,
    );
    expect(screen.getByTestId("panel-modal")).toBeInTheDocument();
    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent("Desk plan");
    expect(screen.getByTestId("panel-modal-body")).toBeInTheDocument();
    expect(screen.getByTestId("modal-child")).toHaveTextContent("body content");
    expect(screen.getByTestId("panel-modal-actions")).toHaveTextContent("Apply");
  });

  test("hides the actions bar when no actions are given", () => {
    r(
      <PanelModal open title="Plain" onClose={() => {}}>
        <div>body</div>
      </PanelModal>,
    );
    expect(screen.queryByTestId("panel-modal-actions")).not.toBeInTheDocument();
  });

  test("close X calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    r(
      <PanelModal open title="Closable" onClose={onClose}>
        <div>body</div>
      </PanelModal>,
    );
    await user.click(screen.getByTestId("panel-modal-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Esc calls onClose", () => {
    const onClose = vi.fn();
    r(
      <PanelModal open title="Escapable" onClose={onClose}>
        <div>body</div>
      </PanelModal>,
    );
    fireEvent.keyDown(screen.getByTestId("panel-modal-title"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  test("closed modal renders no title bar or body", () => {
    r(
      <PanelModal open={false} title="Hidden" onClose={() => {}}>
        <div data-testid="modal-child">body content</div>
      </PanelModal>,
    );
    expect(screen.queryByTestId("panel-modal-title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("modal-child")).not.toBeInTheDocument();
  });
});
