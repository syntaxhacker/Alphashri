// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { Modal as RealModal } from "@/ui/overlay/Modal";
import { mockSolidUi } from "./solidUiMock";

afterEach(cleanup);

describe("solidUiMock Modal double", () => {
  test("it still renders a × when onClose exists, but honours withCloseButton={false}", () => {
    const { Modal: MockModal } = mockSolidUi() as unknown as {
      Modal: (props: Record<string, unknown>) => unknown;
    };

    render(() => (
      <MockModal opened onClose={vi.fn()} title="Details" data-testid="mock-modal">
        body
      </MockModal>
    ));
    expect(screen.getByTestId("mock-modal-close")).toBeInTheDocument();

    cleanup();
    render(() => (
      <MockModal opened onClose={vi.fn()} title="Article" withCloseButton={false} data-testid="bare-modal">
        body
      </MockModal>
    ));
    expect(screen.queryByTestId("bare-modal-close")).toBeNull();
  });

  test("the double is not what certifies dismissal — the real Modal withholds nothing", () => {
    // Guard against the exact regression this double caused: a title bar with no
    // exit. The real component must render a × for a titled modal even when the
    // double would have been the only witness.
    render(() => (
      <RealModal opened onClose={vi.fn()} title="Details" data-testid="real-modal">
        body
      </RealModal>
    ));
    const close = screen.getByTestId("real-modal-close");
    expect(close).toBeInTheDocument();
    fireEvent.click(close);
  });
});
